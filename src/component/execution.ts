import * as vscode from 'vscode';
import { AxiosError } from 'axios';
import { Mutex } from './mutex';
import { Progress } from './superProgress/super-progress';
import { logDebug } from '../common/common';
import { promptZeppelinServerURL, promptCreateParagraph
} from '../common/interaction';
import { parseCellInterpreter,
    parseParagraphResultToCellOutput } from '../common/parser';
import { ParagraphData, ParagraphResult } from '../common/types';
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

    public scheduleTracking()
    {
        if (this.isTrackingScheduled())
        {
            logDebug("executionManager omits duplicated scheduling");
            return;
        }

        let config = vscode.workspace.getConfiguration('zeppelin');
        if (this._timerTrackExecution === undefined)
        {
            let trackExecutionInterval = config.get('execution.trackInterval', 1);

            this._timerTrackExecution = setInterval(
                this._doTrackAllExecution.bind(this),
                trackExecutionInterval * 1000);
        }
    }

    public unscheduleTracking()
    {
        if (this.isTrackingScheduled())
        {
            clearInterval(this._timerTrackExecution);
            this._timerTrackExecution = undefined;
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
            const cellOutput = parseParagraphResultToCellOutput(
                paragraph.results, pbText
            );
            try{
            execution.replaceOutput(new vscode.NotebookCellOutput(cellOutput));
            }
            catch (err) {
                logDebug("trackExecution error", err, execution);
            }
        }
        else if (paragraph.status !== "PENDING")
        {
            const pbOutput = vscode.NotebookCellOutputItem.stdout(pbText);
            try{

            execution.replaceOutput(new vscode.NotebookCellOutput([pbOutput]));
            }
            catch (err) {
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

    private async _dispatchInterpreter(cell: vscode.NotebookCell)
    {
        let interpreterId = parseCellInterpreter(cell) ?? '';
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
            promptZeppelinServerURL(this.kernel);
            return;
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

        await this.kernel.instantUpdatePollingParagraphs();

        let res = await this.kernel.getService()?.stopAll(note.metadata.id);
        return res?.data;
	}

    private async _doExecutionSync(cell: vscode.NotebookCell)
    {
        if (!this.kernel.isActive() || cell.index < 0)
        {
            return false;
        }

        await this.kernel.instantUpdatePollingParagraphs();

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
            logDebug("_doExecutionSync", error);
            return false;
        }

        execution.token.onCancellationRequested(_ =>
        {
            return this._cancelToken(execution);
        });

        try
        {
            this.kernel.runParagraph(cell, true);
        }
        catch (err)
        {
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
        this.registerTrackExecution(execution);

        return true;
    }

    private async _doExecutionAsync(cell: vscode.NotebookCell): Promise<void>
    {
        if (!this.kernel.isActive()
            || this.getExecutionByParagraphId(cell.metadata.id))
        {
            return;
        }

        await this.kernel.instantUpdatePollingParagraphs();

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

            if ((paragraph.status !== "RUNNING")
                    && (cell.metadata.status !== "PENDING"))
            {
                this.kernel.runParagraph(cell, false);
            }
            else
            {
                logDebug("_doExecutionAsync register running paragraph",
                    paragraph);
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
            newExecution.start(startTime);
            this.registerTrackExecution(newExecution);
        }
        else if (serverCell?.metadata?.status !== "PENDING")
        {
            startTime = Date.parse(cell.metadata.dateStarted);
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
            this.registerTrackExecution(newExecution);
        }
    }
}