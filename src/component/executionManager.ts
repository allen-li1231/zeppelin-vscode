import * as vscode from 'vscode';
import { AxiosError } from 'axios';
import { Mutex } from './mutex';
import { Progress } from './superProgress/super-progress';
import { logDebug } from '../common/common';
import { promptZeppelinServerURL, promptCreateParagraph
} from '../common/interaction';
import { parseParagraphResultToCellOutput } from '../common/parser';
import { ParagraphData, ParagraphResult } from '../common/types';
import { ZeppelinKernel } from '../extension/notebookKernel';


export class ExecutionManager
{
    private _executeMutex = new Mutex("_executeMutex");
    private _mapTrackExecution = new Map<
        string, [vscode.NotebookCellExecution, number, Progress]
    >();
    
    private _timerTrackExecution?: NodeJS.Timer;

    public kernel: ZeppelinKernel;

    constructor(kernel: ZeppelinKernel)
    {
        this.kernel = kernel;
		kernel.getController().executeHandler = 
            this._executeAll.bind(this);
		// this._controller.interruptHandler = this._interruptAll.bind(this);
    }

    dispose(): void
    {
        this.kernel.getController().executeHandler = () => {};
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

    public registerTrackExecution(execution: vscode.NotebookCellExecution)
    {
        this._mapTrackExecution.set(
            execution.cell.metadata.id, 
            [execution, Date.now(), Progress.create(57)]
        );
    }

    public unregisterTrackExecution(execution: vscode.NotebookCellExecution)
    {
        return this._mapTrackExecution.delete(execution.cell.metadata.id);
    }

    public getExecutionByParagraphId(paragraphId: string)
    {
        return this._mapTrackExecution.get(paragraphId)?.[0];
    }

    public async trackExecution(
        execution: vscode.NotebookCellExecution,
        progressbar: Progress
    ) {
        if (execution.cell.index < 0)
        {
            logDebug(`trackExecution: unregister as cell deleted`, execution);
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
            execution.end(false, Date.now());
            return;
        }

        const progress = paragraph.status === "RUNNING"
            ? paragraph.progress
            : 100;
        const pbText = await progressbar.renderProgress(progress ?? 0);
        // execution.setProgress(progress);
        if (paragraph.results)
        {
            const cellOutput = parseParagraphResultToCellOutput(
                paragraph.results, pbText
            );
            execution.replaceOutput(new vscode.NotebookCellOutput(cellOutput));
        }
        else if (paragraph.status === "PENDING")
        {
            execution.clearOutput();
        }
        else
        {
            const pbOutput = vscode.NotebookCellOutputItem.stdout(pbText);
            execution.replaceOutput(new vscode.NotebookCellOutput([pbOutput]));
        }

        if ((paragraph.status !== "RUNNING") && (paragraph.status !== "PENDING"))
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
        let config = vscode.workspace.getConfiguration('zeppelin');
        let interval: number = config.get('trackExecutionInterval', 5);
        let aryExecution = [];

        for (let [_, [execution, requestTime, progressbar]]
            of this._mapTrackExecution)
        {
            logDebug("_doTrackAllExecution: tracking",
                execution,
                Date.now() - requestTime);

            if (interval * 1000 < Date.now() - requestTime)
            {
                aryExecution.push(this.trackExecution(execution, progressbar));
            }
        }

        return Promise.all(aryExecution);
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
        let concurrency = config.get('execution.concurrency', 'sequential');
        for (let cell of cells)
        {
            logDebug(`execute in ${concurrency}`, cell);
            if (concurrency === 'parallel')
            {
                this._doExecutionAsync(cell);
            }
            else
            {
                let isSuccess = await this._executeMutex.runExclusive(
                    async () => {
                    return await this._doExecutionSync(cell);
                });
                if (!isSuccess) {return;}
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

        const execution = this.kernel.getController()
            .createNotebookCellExecution(cell);
        execution.token.onCancellationRequested(async _ =>
        {
            this.kernel.getService()?.cancelConnect();
            this.kernel.stopParagraph(execution.cell);
            execution.clearOutput();
        });

        execution.start(Date.now());

        try
        {
            let cellOutput = await this.kernel.runParagraph(cell, true);
            if (cellOutput && cellOutput.length > 0)
            {
                execution.replaceOutput(
                    new vscode.NotebookCellOutput(cellOutput)
                );
            }
            else
            {
                execution.clearOutput();
            }
            execution.end(true, Date.now());
            return true;
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
    }

    private async _doExecutionAsync(cell: vscode.NotebookCell): Promise<void>
    {
        if (!this.kernel.isActive() || this.getExecutionByParagraphId(cell.metadata.id))
        {
            return;
        }

        await this.kernel.instantUpdatePollingParagraphs();

        if (cell.metadata.status === 404)
        {
            promptCreateParagraph(this.kernel, cell);
            return;
        }

        const execution = this.kernel.getController().createNotebookCellExecution(cell);
        execution.token.onCancellationRequested(async _ =>
        {
            await this.kernel.stopParagraph(execution.cell);
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
                logDebug("_doExecutionAsync register running paragraph", paragraph);
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
}