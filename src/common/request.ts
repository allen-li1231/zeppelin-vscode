/* eslint-disable @typescript-eslint/naming-convention */
import { pickBy, identity, isEmpty } from 'lodash';
import { logDebug, formatURL, NAME } from './common';
import * as vscode from 'vscode';
import { Method, RequestHeaderField } from './httpConstants';

// full documentation available here: https://github.com/axios/axios#request-config
// using default values for undefined
export interface Request {
    url?: string | undefined,
    method: string, 
    baseURL: string,
    headers?: any | undefined,
    params?: any | undefined,
    data?: string | any | undefined,
    timeout?: number | undefined,
    withCredentials?: boolean | false, 
    auth?: any | undefined,
    responseType?: string | undefined, 
    responseEncoding?: string | undefined, 
    xsrfCookieName?: string | undefined, 
    xsrfHeaderName?: string | undefined,
    maxContentLength?: number | undefined,
    maxBodyLength?: number | undefined,
    maxRedirects?: number | undefined, 
    socketPath?: any | undefined, 
    proxy?: any | undefined,
    decompress?: boolean | true 
}

export class RequestParser {
    private originalText: string[];
    //private originalRequest: string[];
    private requestOptions: Request | undefined;
    private baseUrl?: string;
    private variableName: string | undefined;
    private valuesReplacedBySecrets: string[] = [];

    constructor(query: string, eol: vscode.EndOfLine) {

        let linesOfText = query.split((eol === vscode.EndOfLine.LF ? '\n' : '\r\n'));

        if (linesOfText.filter(s => { return s; }).length === 0) {
            throw new Error('Please provide request information (at minimum a URL) before running the cell!');
        }

        logDebug(linesOfText);

        this.originalText = linesOfText;

        // this.requestOptions = {
        //     method: this._parseMethod(),
        //     baseURL: this._parseBaseUrl(),
        //     timeout: 10000
        // };

        // this.requestOptions.params = this._parseQueryParams();

        let defaultHeaders = {};

        // eslint-disable-next-line @typescript-eslint/naming-convention
        if(process.env.NODE_ENV) {
            defaultHeaders = { "User-Agent": NAME };
        }
        // this.requestOptions.headers = this._parseHeaders() ?? defaultHeaders;

        // this.requestOptions.data = this._parseBody();
    }

    getRequest(): any | undefined {
        if(this.requestOptions === undefined) { return undefined; }
        return pickBy(this.requestOptions, identity);
    }

    getBaseUrl(): string | undefined {
        return this.baseUrl;
    }

    getVariableName(): string | undefined {
        return this.variableName;
    }

    wasReplacedBySecret(text: string): boolean {
        if(typeof text === 'string') {
            for(let replaced of this.valuesReplacedBySecrets) {
                if(text.includes(replaced)) {
                    return true;
                }
            }
        } else if(typeof text === 'number') {
            for(let replaced of this.valuesReplacedBySecrets) {
                if(`${text}`.includes(replaced)) {
                    return true;
                }
            }
        }

        return false;
    }
}