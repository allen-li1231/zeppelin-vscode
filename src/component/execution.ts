import * as vscode from 'vscode';
import { AxiosError } from 'axios';
import { Mutex } from './mutex';
import { Progress } from './superProgress/super-progress';
import { isLocalNotebook } from '../common/common';
import { logger } from '../common/logger';
import { promptZeppelinServerURL, promptCreateParagraph
} from '../common/interaction';
import { parseCellInterpreter,
    parseParagraphResultToCellOutput } from '../common/parser';
import { ParagraphData } from '../common/types';
import { ZeppelinKernel } from '../extension/notebookKernel';


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
            logger.debug(
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
            logger.debug(
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

    private _timerTrackExecution?: ReturnType<typeof setTimeout>;

    public kernel: ZeppelinKernel;

    constructor(kernel: ZeppelinKernel)
    {
        this.kernel = kernel;
        this.attachHandlers();
        this._mapInterpreterQueue.set('', new Mutex("interpreter default"));
    }

    /**
     * (Re-)install executeHandler and interruptHandler on the notebook
     * controller.  Called from the constructor and again after
     * deactivate → activate so the Run / Stop buttons keep working
     * after a session-expiry cycle.
     */
    public attachHandlers(): void
    {
        this.kernel.getController().executeHandler =
            this._executeAll.bind(this);
        this.kernel.getController().interruptHandler =
            this._interruptAll.bind(this);
    }

    dispose(): void
    {
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

    public scheduleTracking()
    {
        if (this.isTrackingScheduled())
        {
            logger.debug("executionManager omits duplicated scheduling");
            return;
        }
        logger.info("executionManager: scheduling execution tracking");

        let config = vscode.workspace.getConfiguration('zeppelin');
        let trackExecutionInterval = config.get('execution.trackInterval', 1);
        this._scheduleTrackExecution(trackExecutionInterval * 1000);
    }

    private _scheduleTrackExecution(intervalMs: number)
    {
        this._timerTrackExecution = setTimeout(async () =>
        {
            await this._doTrackAllExecution();
            // Only reschedule if not cancelled
            if (this._timerTrackExecution !== undefined)
            {
                this._scheduleTrackExecution(intervalMs);
            }
        }, intervalMs);
    }

    public unscheduleTracking()
    {
        if (this.isTrackingScheduled())
        {
            clearTimeout(this._timerTrackExecution);
            this._timerTrackExecution = undefined;
        }
    }

    public cancelAllExecutions()
    {
        logger.warn(`cancelAllExecutions: cancelling ${this._mapTrackExecution.size} tracked executions`);
        for (let [_, execution] of this._mapTrackExecution)
        {
            if (execution.state === ZeppelinExecutionState.init)
            {
                execution.start(Date.now());
            }
            if (execution.state === ZeppelinExecutionState.started)
            {
                execution.end(false, Date.now());
            }
        }
        this._mapTrackExecution.clear();

        // cancel in-flight HTTP requests
        this.kernel.getService()?.cancelConnect();
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

    public async trackExecution(
        execution: ZeppelinExecution
    ) {
        if (execution.cell.index < 0)
        {
            logger.debug(`trackExecution: unregister as cell deleted`, execution);
            this.unregisterTrackExecution(execution);
            return;
        }

        if (this.kernel.hasPendingParagraphUpdate(execution.cell))
        {
            await this.kernel.updatePollingParagraphsDirect();
        }

        if (execution.state === ZeppelinExecutionState.resolved)
        {
            logger.debug(`trackExecution: unregister as cell resolved`, execution);
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
            logger.error("error in trackExecution:", err);
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
            execution.start(Date.now());
            this.registerTrackExecution(execution);
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
                logger.error("trackExecution error", err, execution);
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
                logger.error("trackExecution error", err, execution);
            }
        }

        if ((paragraph.status !== "RUNNING")
            && (paragraph.status !== "PENDING"))
        {
            logger.debug(`trackExecution: unregister as not running`, execution);
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
            logger.debug(
                "_doTrackAllExecution: tracking", execution
            );
            aryExecution.push(this.trackExecution(execution));
        }

        return Promise.all(aryExecution);
    }

    private async _dispatchInterpreter(cell: vscode.NotebookCell)
    {
        let interpreterId = parseCellInterpreter(cell, false) ?? '';
        if (!this._mapInterpreterQueue.has(interpreterId))
        {
            this._mapInterpreterQueue.set(
                interpreterId, new Mutex(`interpreter ${interpreterId}`)
            );
        }

        this._mapInterpreterQueue.get(interpreterId)?.runExclusive(
            () =>
            {
                return this._doExecutionSync(cell);
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
            vscode.window.showWarningMessage(
                'Zeppelin extension is not activated. Please connect to a server first.',
                'Connect'
            ).then(selection => {
                if (selection === 'Connect')
                {
                    promptZeppelinServerURL(this.kernel);
                }
            });
            return;
        }
        else if (!isLocalNotebook(_notebook.uri))
        {
            vscode.window.showWarningMessage(
                'Please run the corresponding cells in the source Zeppelin notebook.',
            )
            return;
        }

        let config = vscode.workspace.getConfiguration('zeppelin');
        let concurrency = config.get('execution.concurrency', 'by interpreter');
        for (let cell of cells)
        {
            logger.debug(`execute in ${concurrency}`, cell);
            if (cell.index === -1) {
                logger.debug("executeAll skips a deleted cell", cell);
                continue;
            }

            if (cell.metadata.resolvingDiff || cell.metadata.syncConflict !== undefined)
            {
                logger.warn("executeAll skips a cell in resolving diff", cell);
                vscode.window.showWarningMessage(
                    `Please resolve the conflict before executing cell ${cell.index + 1}.`
                );
                continue;
            }
            
            if (this.kernel.hasPendingParagraphUpdate(cell))
            {
                await this.kernel.updatePollingParagraphsDirect();
            }

            if (concurrency === "parallel")
            {
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

        await this.kernel.updatePollingParagraphsDirect();

        let res = await this.kernel.getService()?.stopAll(note.metadata.id);
        return res?.data;
	}

    private async _doExecutionSync(cell: vscode.NotebookCell)
    {
        if (!this.kernel.isActive() || cell.index < 0)
        {
            return false;
        }

        // Guard against creating a duplicate execution for a cell
        // that already has an active one (e.g. triggered by syncNote
        // while a previous run is still in flight).
        if (this.getExecutionByParagraphId(cell.metadata.id))
        {
            logger.debug("_doExecutionSync: skipping, execution already exists for cell", cell);
            return true;
        }

        await this.kernel.updatePollingParagraphsDirect();

        if (cell.metadata.status === 404)
        {
            promptCreateParagraph(this.kernel, cell);
            return;
        }

        let execution: ZeppelinExecution;
        try {
            execution = new ZeppelinExecution(this.kernel, cell);
        }
        catch (error) {
            logger.error("_doExecutionSync", error);
            return false;
        }

        execution.token.onCancellationRequested(_ =>
        {
            return this._cancelToken(execution);
        });

        execution.start(Date.now());
        // Register immediately so syncNote/resumeExecutionStatus can
        // find this execution during the await below, preventing a
        // duplicate createNotebookCellExecution for the same cell.
        this.registerTrackExecution(execution);

        try
        {
            await this.kernel.runParagraph(cell, true);
        }
        catch (err)
        {
            this.unregisterTrackExecution(execution);
            let cellOutput: vscode.NotebookCellOutput;

            if (err instanceof AxiosError && err.code === "ERR_CANCELED")
            {
                execution.end(false, Date.now());
            }
            else
            {
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
            }
            return false;
        }

        return true;
    }

    private async _doExecutionAsync(cell: vscode.NotebookCell): Promise<void>
    {
        if (!this.kernel.isActive()
            || this.getExecutionByParagraphId(cell.metadata.id))
        {
            return;
        }

        if (cell.metadata.resolvingDiff)
        {
            vscode.window.showWarningMessage(
                'Resolve the sync conflict before executing this cell.'
            );
            return;
        }

        await this.kernel.updatePollingParagraphsDirect();

        if (cell.metadata.status === 404)
        {
            promptCreateParagraph(this.kernel, cell);
            return;
        }

        const execution = new ZeppelinExecution(this.kernel, cell);
        execution.token.onCancellationRequested(_ =>
        {
            return this._cancelToken(execution);
        });

        try {
            let paragraph = await this.kernel.getParagraphInfo(cell);

            if (paragraph === undefined
                || (paragraph.status === "RUNNING")
                || (cell.metadata.status === "PENDING"))
            {
                logger.debug("_doExecutionAsync omit running/non-existent paragraph",
                    paragraph);
                // Properly dispose the VS Code execution to avoid
                // a leaked pending spinner and blocking future runs.
                execution.start(Date.now());
                execution.end(undefined, Date.now());
                return
            }
            else 
            {
                await this.kernel.runParagraph(cell, false);
            }
        }
        catch (err)
        {
            execution.start(Date.now());
            let cellOutput: vscode.NotebookCellOutput;

            if (err instanceof AxiosError && err.code === "ERR_CANCELED")
            {
                execution.end(false, Date.now());
            }
            else
            {
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
            }
            return;
        }

        execution.start(Date.now());
        // execution.setProgress(10);
        this.registerTrackExecution(execution);
    }

    public async resumeExecutionStatus(
        cell: vscode.NotebookCell,
        serverCell: vscode.NotebookCellData
    ) {
        let execution: ZeppelinExecution | undefined =
            this.getExecutionByParagraphId(cell.metadata.id);

        // If an active (non-resolved) execution already exists for this
        // cell, keep tracking it — but still sync remote outputs so the
        // cell reflects the latest server state.
        if (execution !== undefined
            && execution.state !== ZeppelinExecutionState.resolved)
        {
            logger.debug(
                "resumeExecutionStatus: keep existing execution",
                execution
            );
            if (serverCell?.outputs)
            {
                execution.replaceOutput(serverCell.outputs);
            }
            this.registerTrackExecution(execution);
            return;
        }

        let startTime: number | undefined = execution?.startTime;

        let newExecution = new ZeppelinExecution(this.kernel, cell);
        newExecution.token.onCancellationRequested(_ =>
        {
            return this._cancelToken(newExecution);
        });

        if (startTime !== undefined
            || serverCell?.metadata?.status === "RUNNING")
        {
            logger.debug("resumeExecutionStatus resuming", cell);
            newExecution.start(startTime);
            this.registerTrackExecution(newExecution);
        }
        else if (serverCell?.metadata?.status !== "PENDING")
        {
            startTime = Date.parse(cell.metadata.dateStarted) || Date.now();
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

            newExecution.end(
                cell.metadata.status !== "ERROR",
                Date.parse(cell.metadata.dateFinished) || Date.now()
            );
        }
        else
        {
            // Still sync remote outputs for RUNNING/PENDING cells
            if (serverCell?.outputs)
            {
                newExecution.replaceOutput(serverCell.outputs);
            }
            this.registerTrackExecution(newExecution);
        }
    }
}