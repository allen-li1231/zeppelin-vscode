import * as vscode from 'vscode';
import { AxiosError } from 'axios';
import { Mutex } from './mutex';
import { Progress } from './superProgress/super-progress';
import { logDebug } from '../common/common';
import { promptZeppelinServerURL } from '../common/interaction';
import { parseCellInterpreter,
    parseParagraphResultToCellOutput } from '../common/parser';
import { ParagraphData } from '../common/types';
import { ZeppelinKernel } from '../extension/notebookKernel';
// NOTE: REST API used for all one-time operations (run, cancel, etc.)
// WebSocket only for continuous background sync


/**
 * Parse Zeppelin date string to timestamp.
 * Zeppelin returns dates like "Feb 1, 2026 9:13:40 AM" without timezone info.
 * 
 * IMPORTANT: Zeppelin stores dates in UTC but formats them without timezone suffix.
 * We need to append "UTC" to parse correctly, otherwise Date.parse() interprets
 * as local time causing timezone offset issues (e.g., 5:30 hour offset for IST users).
 * 
 * @param dateStr The date string from Zeppelin API
 * @returns Parsed timestamp in milliseconds, or undefined if invalid
 */
function parseZeppelinDate(dateStr: string | undefined): number | undefined
{
    if (!dateStr)
    {
        return undefined;
    }

    // Zeppelin dates are in UTC but without timezone suffix
    // Append " UTC" to ensure correct parsing
    const dateStrWithTz = dateStr.includes("UTC") || dateStr.includes("GMT") 
        ? dateStr 
        : dateStr + " UTC";
    
    const timestamp = Date.parse(dateStrWithTz);
    
    if (isNaN(timestamp))
    {
        // Fallback: try parsing as-is (local time)
        const fallbackTimestamp = Date.parse(dateStr);
        if (!isNaN(fallbackTimestamp))
        {
            logDebug("parseZeppelinDate: parsed as local time (fallback)", dateStr);
            return fallbackTimestamp;
        }
        logDebug("parseZeppelinDate: failed to parse", dateStr);
        return undefined;
    }

    return timestamp;
}


enum ZeppelinExecutionState {
	init,
	started,
	resolved
}


export class ZeppelinExecution implements vscode.NotebookCellExecution
{
    public kernel: ZeppelinKernel;

    private _state = ZeppelinExecutionState.init;
    private _startTime: number | undefined;
    private _endTime: number | undefined;
    private _progressBar: Progress | undefined;

    private _execution: vscode.NotebookCellExecution;

    cell: vscode.NotebookCell;
    token: vscode.CancellationToken;

    get executionOrder(): number | undefined
    {
        return this._execution.executionOrder;
    }
    set executionOrder(value: number | undefined)
    {
        this._execution.executionOrder = value;
    }

    get startTime()
    {
        return this._startTime;
    }

    get endTime()
    {
        return this._endTime;
    }

    get progressBar()
    {
        return this._progressBar;
    }

    constructor(kernel: ZeppelinKernel, cell: vscode.NotebookCell)
    {
        this.kernel = kernel;
        this.cell = cell;
        this._execution = this.kernel.getController()
            .createNotebookCellExecution(cell);
        this.token = this._execution.token;
    }

    // function signature copied from vscode.NotebookCellExecution
    clearOutput(cell?: vscode.NotebookCell): Thenable<void>
    {
        return this._execution.clearOutput(cell);
    }
    replaceOutput(
        out: vscode.NotebookCellOutput
            | readonly vscode.NotebookCellOutput[],
        cell?: vscode.NotebookCell
    ): Thenable<void>
    {
        return this._execution.replaceOutput(out, cell);
    }
    appendOutput(
        out: vscode.NotebookCellOutput
            | readonly vscode.NotebookCellOutput[],
        cell?: vscode.NotebookCell
    ): Thenable<void>
    {
        return this._execution.appendOutput(out, cell);
    }
    replaceOutputItems(
        items: vscode.NotebookCellOutputItem
            | readonly vscode.NotebookCellOutputItem[],
        output: vscode.NotebookCellOutput
    ): Thenable<void>
    {
        return this._execution.replaceOutputItems(items, output);
    }
    appendOutputItems(
        items: vscode.NotebookCellOutputItem
            | readonly vscode.NotebookCellOutputItem[],
        output: vscode.NotebookCellOutput
    ): Thenable<void>
    {
        return this._execution.appendOutputItems(items, output);
    }

    public get state()
    {
        return this._state;
    }

    public start(startTime?: number)
    {
        if (this._state !== ZeppelinExecutionState.init)
        {
            logDebug(
                "execution skip wrong start call",
                this._state, this._execution
            );
            return;
        }

        this._progressBar = Progress.create(57);
        if (startTime !== undefined)
        {
            this._progressBar.state.startTime = startTime;
        }

        this._execution.start(startTime);
        this._state = ZeppelinExecutionState.started;
        this._startTime = startTime;
    }

    public end(success: boolean | undefined, endTime?: number)
    {
        if (this._state !== ZeppelinExecutionState.started)
        {
            logDebug(
                "execution skip wrong end call",
                this._state, this._execution
            );
            return;
        }

        this._execution.end(success, endTime);
        this._state = ZeppelinExecutionState.resolved;
        this._endTime = endTime;
    }

    public async setProgress(progress: number)
    {
        if (this._state !== ZeppelinExecutionState.started)
        {
            throw TypeError(
                "cannot retrieve progress when execution is resolved"
            );
        }
        const pbText = await this._progressBar?.renderProgress(progress);
        return pbText;
    }
}


export class ExecutionManager
{
    private _executeMutex = new Mutex("_executeMutex");
    private _mapTrackExecution = new Map<
        string, ZeppelinExecution
    >();
    private _mapInterpreterQueue = new Map<
        string, Mutex
    >();

    private _timerTrackExecution?: NodeJS.Timer;

    public kernel: ZeppelinKernel;

    constructor(kernel: ZeppelinKernel)
    {
        this.kernel = kernel;
		kernel.getController().executeHandler = 
            this._executeAll.bind(this);
		// this._controller.interruptHandler = this._interruptAll.bind(this);
        this._mapInterpreterQueue.set('', new Mutex("interpreter default"));
    }

    dispose(): void
    {
        this.kernel.getController().executeHandler = () => {};
        this.unscheduleTracking();
        this._mapTrackExecution.clear();
        this._mapInterpreterQueue.clear();
	}

    private _cancelToken(execution: ZeppelinExecution)
    {
        if (this.kernel.isNoteSyncing(execution.cell.notebook))
        {
            return;
        }

        if (execution.cell.index === -1)
        {
            this.unregisterTrackExecution(execution);
        }

        this.kernel.stopParagraph(execution.cell);
    }

    public isTrackingScheduled()
    {
        return !(this._timerTrackExecution === undefined);
    }

    /**
     * Schedule polling for running cells only (5 second interval)
     * Only polls cells that are actively running to fetch results
     */
    public scheduleTracking()
    {
        if (this.isTrackingScheduled())
        {
            logDebug("executionManager omits duplicated scheduling");
            return;
        }

        // Poll every 5 seconds for running cells only
        this._timerTrackExecution = setInterval(async () => {
            await this._pollRunningCells();
        }, 5000);
        
        logDebug("scheduleTracking: polling enabled (5s) for running cells only");
    }

    public unscheduleTracking()
    {
        if (this.isTrackingScheduled())
        {
            clearInterval(this._timerTrackExecution);
            this._timerTrackExecution = undefined;
        }
    }

    /**
     * Poll only running cells to fetch results
     */
    private async _pollRunningCells(): Promise<void> {
        // Only poll if there are running executions
        if (this._mapTrackExecution.size === 0) {
            return;
        }

        logDebug(`_pollRunningCells: checking ${this._mapTrackExecution.size} running cells`);

        for (const [paragraphId, execution] of this._mapTrackExecution) {
            // Only track cells that are actually running
            if (execution.state !== ZeppelinExecutionState.started) {
                continue;
            }

            try {
                await this.trackExecution(execution);
            } catch (error) {
                logDebug(`_pollRunningCells: error tracking ${paragraphId}`, error);
            }
        }
    }

    public registerTrackExecution(execution: ZeppelinExecution)
    {
        this._mapTrackExecution.set(
            execution.cell.metadata.id,
            execution
        );
    }

    public unregisterTrackExecution(
        executionOrCell: ZeppelinExecution | vscode.NotebookCell
    ) {
        let cell: vscode.NotebookCell = "cell" in executionOrCell
            ? executionOrCell.cell
            : executionOrCell;
        return this._mapTrackExecution.delete(cell.metadata.id);
    }

    public getExecutionByParagraphId(paragraphId: string)
    {
        return this._mapTrackExecution.get(paragraphId);
    }

    public getExecutionStartTimeByParagraphId(paragraphId: string)
    {
        return this._mapTrackExecution.get(paragraphId)?.startTime;
    }

    public getExecutionProgressBarByParagraphId(paragraphId: string)
    {
        return this._mapTrackExecution.get(paragraphId)?.progressBar;
    }

    /**
     * Force sync all running executions from server
     * Call this when execution seems stuck
     */
    public async forceSyncAllExecutions(): Promise<void> {
        logDebug("forceSyncAllExecutions: checking all running executions");
        
        for (const [paragraphId, execution] of this._mapTrackExecution) {
            if (execution.state === ZeppelinExecutionState.started) {
                try {
                    await this.trackExecution(execution);
                } catch (error) {
                    logDebug(`forceSyncAllExecutions: error tracking ${paragraphId}`, error);
                }
            }
        }
    }

    /**
     * Force end an execution (for manual cleanup)
     */
    public forceEndExecution(paragraphId: string, success: boolean = false): void {
        const execution = this._mapTrackExecution.get(paragraphId);
        if (execution && execution.state === ZeppelinExecutionState.started) {
            logDebug(`forceEndExecution: ending ${paragraphId}`);
            execution.end(success, Date.now());
            this.unregisterTrackExecution(execution);
        }
    }

    public async trackExecution(
        execution: ZeppelinExecution
    ) {
        if (execution.cell.index < 0)
        {
            logDebug(`trackExecution: unregister as cell deleted`, execution);
            this.unregisterTrackExecution(execution);
            return;
        }

        if (execution.state === ZeppelinExecutionState.resolved)
        {
            logDebug(`trackExecution: unregister as cell resolved`, execution);
            this.unregisterTrackExecution(execution);
            return;
        }

        let paragraph: ParagraphData;
        try
        {
            paragraph = await this.kernel.getParagraphInfo(execution.cell);
        }
        catch (err)
        {
            logDebug("error in trackExecution:", err);
            
            // Check if this is a network/timeout error - don't end execution, let it retry
            if (err instanceof AxiosError)
            {
                const isNetworkError = !err.response || 
                    err.code === "ECONNABORTED" || 
                    err.response?.status === 504 ||
                    err.response?.status === 408;
                    
                if (isNetworkError)
                {
                    logDebug("trackExecution: network error, will retry on next poll", err);
                    // Don't unregister - will retry on next poll
                    return;
                }
                if (err.response?.status === 404)
                {
                    logDebug("trackExecution: 404 in cell output");
                }
            }
            
            this.unregisterTrackExecution(execution);
            let cellOutput = new vscode.NotebookCellOutput([
                vscode.NotebookCellOutputItem.error({
                    name: err instanceof Error
                        && err.name
                        || 'error',
                    message: err instanceof Error
                        && err.message
                        || JSON.stringify(err, undefined, 4)
                })
            ]);
            execution.replaceOutput(cellOutput);
            if (execution.state === ZeppelinExecutionState.init)
            {
                execution.start();
            }
            execution.end(false, Date.now());
            return;
        }

        if (paragraph.status !== "PENDING"
            && execution.state === ZeppelinExecutionState.init)
        {
            let startTime: number = Date.now();
            if (execution.state === ZeppelinExecutionState.init)
            {
                execution.start(startTime);
                this.registerTrackExecution(execution);
            }
        }

        let pbText: string = '';
        if (paragraph.status === "RUNNING")
        {
            const progress = paragraph.progress ?? 0;
            pbText = await execution.setProgress(progress) ?? '';
        }

        // execution.setProgress(progress);
        if (paragraph.results)
        {
            try
            {
                const cellOutput = parseParagraphResultToCellOutput(
                    paragraph.results, pbText
                );

                // need to explicitly call clearOutput
                // when the output is empty.
                if (cellOutput.length === 0)
                {
                    execution.clearOutput();
                }
                else
                {
                    execution.replaceOutput(
                        new vscode.NotebookCellOutput(cellOutput)
                    );
                }
            }
            catch (err)
            {
                logDebug("trackExecution error", err, execution);
            }
        }
        else if (paragraph.status !== "PENDING")
        {
            try
            {
                const pbOutput = vscode.NotebookCellOutputItem.stdout(pbText);
                execution.replaceOutput(
                    new vscode.NotebookCellOutput([pbOutput])
                );
            }
            catch (err)
            {
                logDebug("trackExecution error", err, execution);
            }
        }

        if ((paragraph.status !== "RUNNING")
            && (paragraph.status !== "PENDING"))
        {
            logDebug(`trackExecution: unregister as not running`, execution);
            this.unregisterTrackExecution(execution);
            execution.end(
                paragraph.status !== "ERROR", Date.now()
                // paragraph.dateFinished
                //     ? Date.parse(paragraph.dateFinished)
                //     : Date.now()
            );
        }
    }

    private async _doTrackAllExecution()
    {
        let aryExecution = [];

        for (let [_, execution] of this._mapTrackExecution)
        {
            logDebug(
                "_doTrackAllExecution: tracking", execution
            );
            aryExecution.push(this.trackExecution(execution));
        }

        return Promise.all(aryExecution);
    }

    private _dispatchInterpreter(cell: vscode.NotebookCell)
    {
        let interpreterId = parseCellInterpreter(cell) ?? '';
        if (!this._mapInterpreterQueue.has(interpreterId))
        {
            this._mapInterpreterQueue.set(
                interpreterId, new Mutex(`interpreter ${interpreterId}`)
            );
        }

        // Queue execution in interpreter's mutex - don't await
        // This allows all cells to be queued immediately
        // The mutex ensures only one cell per interpreter runs at a time
        // but different interpreters run in parallel (like Zeppelin web UI)
        this._mapInterpreterQueue.get(interpreterId)?.runExclusive(
            async () =>
            {
                return await this._doExecutionSync(cell);
            }
        );
    }

    private async _executeAll(
        cells: vscode.NotebookCell[],
        _notebook: vscode.NotebookDocument,
        _controller: vscode.NotebookController
    ) {
        if (!this.kernel.isActive())
        {
            promptZeppelinServerURL(this.kernel);
            return;
        }

        // Check connection health before executing
        if (!this.kernel.isConnectionHealthy())
        {
            const isHealthy = await this.kernel.forceConnectionCheck();
            if (!isHealthy)
            {
                vscode.window.setStatusBarMessage('$(warning) Cannot execute: Server unavailable. Try "Refresh Notebook".', 5000);
                return;
            }
        }

        let config = vscode.workspace.getConfiguration('zeppelin');
        let concurrency = config.get('execution.concurrency', 'by interpreter');
        
        for (let cell of cells)
        {
            logDebug(`execute in ${concurrency}`, cell);
            if (cell.index === -1) {
                logDebug("executeAll skips a deleted cell", cell);
                continue;
            }

            if (concurrency === "parallel")
            {
                // Fire and forget - tracking system will pick up results
                this._doExecutionAsync(cell);
            }
            else if (concurrency === "sequential")
            {
                let isSuccess = await this._executeMutex.runExclusive(
                    async () => {
                    return await this._doExecutionSync(cell);
                });
                if (!isSuccess) {return;}
            }
            else if (concurrency === "by interpreter")
            {
                // Fire and forget - interpreter queue handles ordering internally
                // Each interpreter's mutex ensures proper sequencing within that interpreter
                // but all interpreters run in parallel (like Zeppelin web UI)
                this._dispatchInterpreter(cell);
            }
		}
	}

    private async _interruptAll(note: vscode.NotebookDocument)
    {
        if (!this.kernel.isActive())
        {
            return;
        }

        // Use kernel method which handles WebSocket and REST fallback
        return await this.kernel.stopAllParagraphs(note);
	}

    private async _doExecutionSync(cell: vscode.NotebookCell)
    {
        if (!this.kernel.isActive() || cell.index < 0)
        {
            return false;
        }

        await this.kernel.instantUpdatePollingParagraphs();

        const ready = await this.kernel.ensureCellExistsAndSynced(cell);
        if (!ready) {
            vscode.window.setStatusBarMessage('$(warning) Cell not ready to run. Check connection and try again.', 5000);
            return false;
        }

        let execution: ZeppelinExecution;
        try {
            execution = new ZeppelinExecution(this.kernel, cell);
        }
        catch (error) {
            logDebug("_doExecutionSync", error);
            return false;
        }

        execution.token.onCancellationRequested(_ =>
        {
            return this._cancelToken(execution);
        });

        // Start execution BEFORE sending to server
        execution.start(Date.now());
        this.registerTrackExecution(execution);

        try
        {
            // Fire and forget - do NOT wait for results
            // This releases the mutex immediately so other cells can start
            // Polling (every 5s) will fetch results and update this cell
            await this.kernel.runParagraph(cell, false);
            logDebug("_doExecutionSync: run sent, polling will fetch results");
        }
        catch (err)
        {
            let cellOutput: vscode.NotebookCellOutput;

            if (err instanceof AxiosError && err.code === "ERR_CANCELED")
            {
                execution.end(false, Date.now());
                this.unregisterTrackExecution(execution);
            }
            else if (err instanceof AxiosError && (err.code === "ECONNABORTED" || err.response?.status === 504))
            {
                // Timeout - leave execution running, polling will pick it up
                logDebug("_doExecutionSync: timeout, polling will continue", err);
                vscode.window.setStatusBarMessage(`$(warning) Timeout, waiting for results...`, 3000);
                return true;
            }
            else
            {
                if (err instanceof AxiosError && err.response?.status === 404)
                {
                    logDebug("_doExecutionSync: 404");
                }
                cellOutput = new vscode.NotebookCellOutput([
                    vscode.NotebookCellOutputItem.error({ 
                        name: err instanceof Error
                            && err.name
                            || 'error',
                        message: err instanceof Error
                            && err.message
                            || JSON.stringify(err, undefined, 4)
                    })
                ]);
                execution.replaceOutput(cellOutput);
                execution.end(false, Date.now());
                this.unregisterTrackExecution(execution);
            }
            return false;
        }

        // Return immediately - mutex released, other cells can run
        // Polling will fetch results and end this execution
        return true;
    }

    private async _doExecutionAsync(cell: vscode.NotebookCell): Promise<void>
    {
        if (!this.kernel.isActive())
        {
            return;
        }

        await this.kernel.instantUpdatePollingParagraphs();

        const ready = await this.kernel.ensureCellExistsAndSynced(cell);
        if (!ready) {
            vscode.window.setStatusBarMessage('$(warning) Cell not ready to run. Check connection and try again.', 5000);
            return;
        }

        if (this.getExecutionByParagraphId(cell.metadata?.id))
        {
            return;
        }

        const execution = new ZeppelinExecution(this.kernel, cell);
        execution.token.onCancellationRequested(_ =>
        {
            return this._cancelToken(execution);
        });

        // Start execution BEFORE sending to server
        execution.start(Date.now());
        this.registerTrackExecution(execution);

        try {
            // Check status first via REST API
            let paragraph = await this.kernel.getParagraphInfo(cell);

            if ((paragraph.status !== "RUNNING")
                    && (paragraph.status !== "PENDING"))
            {
                // Only run if not already running/pending
                // Use sync=false for async execution, tracking will pick up results
                await this.kernel.runParagraph(cell, false);
            }
            else
            {
                logDebug("_doExecutionAsync register running paragraph",
                    paragraph);
            }
        }
        catch (err)
        {
            let cellOutput: vscode.NotebookCellOutput;

            if (err instanceof AxiosError && err.code === "ERR_CANCELED")
            {
                execution.end(false, Date.now());
                this.unregisterTrackExecution(execution);
            }
            else if (err instanceof AxiosError && (err.code === "ECONNABORTED" || err.response?.status === 504))
            {
                // Timeout or gateway timeout - don't end execution, let tracking continue
                logDebug("_doExecutionAsync: timeout, will continue tracking", err);
                vscode.window.showWarningMessage(`Execution request timed out. Use "Refresh Notebook" to check status.`);
                // The tracking will pick up results when connection is restored
                return;
            }
            else
            {
                if (err instanceof AxiosError && err.response?.status === 404)
                {
                    logDebug("_doExecutionAsync: 404");
                }
                cellOutput = new vscode.NotebookCellOutput([
                    vscode.NotebookCellOutputItem.error({ 
                        name: err instanceof Error
                            && err.name
                            || 'error', 
                        message: err instanceof Error
                            && err.message
                            || JSON.stringify(err, undefined, 4)
                    })
                ]);
                execution.replaceOutput(cellOutput);
                execution.end(false, Date.now());
                this.unregisterTrackExecution(execution);
            }
            return;
        }
    }

    public async resumeExecutionStatus(
        cell: vscode.NotebookCell,
        serverCell: vscode.NotebookCellData
    ) {
        let execution: ZeppelinExecution | undefined =
            this.getExecutionByParagraphId(cell.metadata.id);

        let startTime: number | undefined = this.
            getExecutionStartTimeByParagraphId(cell.metadata.id);

        if (execution !== undefined)
        {
            this.unregisterTrackExecution(execution);
            if (execution.state === ZeppelinExecutionState.started)
            {
                execution.end(undefined);
            }
        }

        let newExecution = new ZeppelinExecution(this.kernel, cell);
        newExecution.token.onCancellationRequested(_ =>
        {
            return this._cancelToken(newExecution);
        });

        if (startTime !== undefined
            || serverCell?.metadata?.status === "RUNNING")
        {
            logDebug("resumeExecutionStatus resuming", cell);
            // If we don't have startTime from memory (e.g., after window restart),
            // try to get it from the server's dateStarted field
            if (startTime === undefined && serverCell?.metadata?.dateStarted)
            {
                startTime = parseZeppelinDate(serverCell.metadata.dateStarted);
            }
            newExecution.start(startTime);
            this.registerTrackExecution(newExecution);
        }
        else if (serverCell?.metadata?.status !== "PENDING")
        {
            // For completed executions, use dateStarted from server metadata
            // This preserves the correct "Started X min ago" display after window restart
            if (serverCell?.metadata?.dateStarted)
            {
                startTime = parseZeppelinDate(serverCell.metadata.dateStarted);
            }
            newExecution.start(startTime);
            this.registerTrackExecution(newExecution);
        }

        if ((serverCell?.metadata?.status !== "RUNNING")
            && (serverCell?.metadata?.status !== "PENDING"))
        {
            if (serverCell?.outputs)
            {
                newExecution.replaceOutput(serverCell?.outputs);
            }
            else
            {
                newExecution.clearOutput();
            }

            // Use dateFinished from server metadata for accurate end time display
            let endTime: number | undefined = parseZeppelinDate(serverCell?.metadata?.dateFinished);
            if (endTime === undefined)
            {
                endTime = Date.now();
            }

            newExecution.end(
                serverCell?.metadata?.status !== "ERROR",
                endTime
            );
        }
        else
        {
            this.registerTrackExecution(newExecution);
        }
    }
}