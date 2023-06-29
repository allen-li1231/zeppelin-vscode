/* eslint-disable @typescript-eslint/naming-convention */
import { window } from 'vscode';
import { logDebug, formatURL, reCookies } from './common';
import { NoteData,
    ParagraphData,
    ParagraphConfig,
    ParagraphResult
} from './dataStructure';
import axios, {
    AxiosInstance,
    AxiosRequestConfig,
    AxiosProxyConfig,
    CancelTokenSource,
    AxiosError
} from 'axios';


class BasicService {
    public baseURL: string;
    public session: AxiosInstance;
    public cancelTokenSource: CancelTokenSource;
    public config: AxiosRequestConfig;

    constructor(
        baseURL: string,
        proxy: AxiosProxyConfig | undefined = undefined
    ) {
        this.baseURL = formatURL(baseURL);

        const cancelTokenAxios = axios.CancelToken.source();

        const config: AxiosRequestConfig = {
            baseURL: this.baseURL,
            withCredentials: true,
            cancelToken: cancelTokenAxios.token,
            maxRedirects: 0,
            responseType: 'json',
            responseEncoding: 'utf8'
      };

      if (proxy) {
        config.proxy = proxy;
      }

      this.session = axios.create(config);
      this.cancelTokenSource = cancelTokenAxios;
      this.config = config;
      this.session.defaults.headers.common["User-Agent"] = 'ZeppelinExtension/VSode';

      // create request session based on config
      this.session.interceptors.response.use(
            (response) => {
                logDebug(response);
                return response;
            },
            (error) => {
                logDebug(error);
                // instead of rejecting error, pass it to outer scope
                return error;
            }
        );
    }

    async login(username: string, password: string) {
        let res = await this.session.post(
            '/api/login',
            { userName: username, password: password },
            {
                withCredentials: true,
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'X-Requested-With': 'XMLHttpRequest',
                },
            }
        );

        // store cookies to default headers
        if (res.headers['set-cookie']) {
            for (let cookie of res.headers['set-cookie']) {
                let group = reCookies.exec(cookie);
                if (group) {
                    this.session.defaults.headers.common['Cookie'] = group[1];
                    this.session.defaults.headers.common['Content-Type'] = 'application/json';
                    //break;
                }
            }
        }
        return res;
    }
}


export class NotebookService extends BasicService{

    constructor(
        baseUrl: string,
        proxy: AxiosProxyConfig | undefined = undefined
    ) {
        super(baseUrl, proxy);
    }

    listNotes() {
        return this.session.get(
            '/api/notebook',
        );
    }

    createNote(name: string, paragraphs: ParagraphData[]) {
        return this.session.post(
            '/api/notebook',
            { name: name, paragraphs: paragraphs }
        );
    }

    deleteNote(noteId: string) {
        return this.session.delete(
            `/api/notebook/${noteId}`
        );
    }

    importNote(note: NoteData) {
        return this.session.post(
            '/api/notebook/import',
            note
        );
    }

    cloneNote(noteId: string, newNoteName: string) {
        return this.session.post(
            `/api/notebook/${noteId}`,
            { name: newNoteName }
        );
    }

    exportNote(noteId: string, newNoteName: string) {
        return this.session.post(
            `/api/notebook/${noteId}`,
            { name: newNoteName }
        );
    }

    getAllStatus(noteId: string) {
        return this.session.get(
            `/api/notebook/job/${noteId}`
        );
    }

    getInfo(noteId: string) {
        return this.session.get(
            '/api/notebook/' + noteId
        );
    }

    runAll(noteId: string) {
        return this.session.post(
            `/api/notebook/job/${noteId}`
        );
    }

    stopAll(noteId: string) {
        return this.session.delete(
            `/api/notebook/job/${noteId}`
        );
    }

    clearAllResult(noteId: string) {
        return this.session.put(
            `/api/notebook/${noteId}/clear`
        );
    }

    addCron(noteId: string, cron: string, releaseResource: boolean = false) {
        return this.session.post(
            `/api/notebook/cron/${noteId}`,
            { cron: cron, releaseResource: releaseResource}
        );
    }
    removeCron(noteId: string) {
        return this.session.delete(
            `/api/notebook/cron/${noteId}`
        );
    }

    getCron(noteId: string) {
        return this.session.get(
            `/api/notebook/cron/${noteId}`
        );
    }

    getPermission(noteId: string) {
        return this.session.get(
            `/api/notebook/${noteId}/permissions`
        );
    }

    setPermission(
        noteId: string,
        readers: string[], 
        owners: string[], 
        runners: string[], 
        writers: string[]
    ) {
        return this.session.post(
            `/api/notebook/cron/${noteId}`,
            {
                readers: readers,
                owners: owners,
                runners: runners,
                writers: writers
            }
        );
    }

    createParagraph(
        noteId: string,
        text: string,
        title?: string,
        index: number = -1,
        config?: ParagraphConfig
        ) {
            let data: CreateParagraphData = { text: text, index: index };
            if (title) {
                data.title = title;
            }
            if (config) {
                data.config = config;
            }
            return this.session.post(
                `/api/notebook/${noteId}/paragraph`,
                data
            );
    }

    getParagraphInfo(noteId: string, paragraphId: string) {
        return this.session.get(
            `/api/notebook/${noteId}/${paragraphId}`
        );
    }

    getParagraphStatus(noteId: string, paragraphId: string) {
        return this.session.get(
            `/api/notebook/job/${noteId}/${paragraphId}`
        );
    }

    updateParagraphText(
        noteId: string,
        paragraphId: string,
        text: string,
        title?: string
    ) {
        let data;
        if (title){
            data = { text: text, title: title };
        }
        else {
            data = { text: text };
        }

        return this.session.put(
            `/api/notebook/${noteId}/paragraph/${paragraphId}`,
            data
        );
    }

    updateParagraphConfig(noteId: string, paragraphId: string, config: ParagraphConfig) {
        return this.session.put(
            `/api/notebook/${noteId}/paragraph/${paragraphId}/config`,
            config
        );
    }

    moveParagraphToIndex(noteId: string, paragraphId: string, index: number) {
        return this.session.post(
            `/api/notebook/${noteId}/paragraph/${paragraphId}/move/` + index.toString()
        );
    }

    deleteParagraph(noteId: string, paragraphId: string) {
        return this.session.delete(
            `/api/notebook/${noteId}/paragraph/${paragraphId}`
        );
    }

    async runParagraph(noteId: string, paragraphId: string, sync: boolean = true, option?: any) {
        // let t = await this.listNotes();
        let url;
        if (sync) {
            url = `/api/notebook/run/${noteId}/${paragraphId}`;
        }
        else {
            url = `/api/notebook/job/${noteId}/${paragraphId}`;
        }

        let res;
        if (option){
            res = await this.session.post(
                url,
                option
            );
        }
        else {
            res = await this.session.post(url);
        }

        if (res instanceof AxiosError) {
            throw res;
        }

        return <ParagraphResult> res.data.body;
    }

    stopParagraph(noteId: string, paragraphId: string) {
        return this.session.delete(
            `/api/notebook/job/${noteId}/${paragraphId}`
        );
    }
}

interface CreateParagraphData {
    text: string,
    title?: string,
    index?: number,
    config?: ParagraphConfig
}