// the Zeppelin note is basically a json file
// containing note and paragraph information
export interface NoteData {
	angularObjects?: AngularObjects;
	config?: NotebookConfig;
	id: string;
	info?: NoteInfo;
    name: string;
    noteForms?: any;
    noteParams?: any;
    paragraphs: ParagraphData[];
}

export interface AngularObjects {
    // TODO: fill in the value format by refering to official doc
	[interpreterAndUser: string]: any[];}

export interface NotebookConfig {
	isZeppelinNotebookCronEnable: boolean;
	looknfeel: string;
	personalizedMode: string;
}

export interface NoteInfo {
    inIsolatedMode: boolean;
}

export interface ParagraphData {
    config: ParagraphConfig;
    dateCreated?: string;
    dateUpdated?: string;
    errorMessage?: string;
    focus?: boolean,
    id?: string;
    jobName?: string;
    progressUpdateIntervalMs?: number;
    settings?: ParagraphSetting;
    results?: ParagraphResult;
    status: string;
    text: string;
    user?: string;
}

export interface ParagraphConfig {
    colWidth?: number;
    editorMode?: string;
    editorSetting: {
        completionKey: string;
        completionSupport: boolean;
        editOnDblClick: boolean;
        language: string;
    },
    enabled?: boolean;
    fontSize?: number;
    results?: {};
}

export interface ParagraphSetting {
    forms: any;
    params: any;
}

export interface ParagraphResult {
    code: string;
    msg: ParagraphResultMsg[]
}

export interface ParagraphResultMsg {
    data: string;
    type: string;
}