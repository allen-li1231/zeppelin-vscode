import { logDebug } from './common';
import { ResponseHeaderField } from './httpConstants';
import { RequestParser } from './request';

export interface ResponseRendererElements {
    status: number,
    statusText: string,
    headers?: any | undefined,
    config?: any | undefined,
    request?: any | undefined,
    data: any
}

export class ResponseParser {
    private status: number| undefined;
    private statusText: string | undefined;
    private headers: any | undefined;
    private config: any | undefined;
    private request: any | undefined;
    private data: any | undefined;

    private reqParser: RequestParser;

    constructor(response: any, request: any, reqParser: RequestParser) {
        logDebug(response);
        this.reqParser = reqParser;

        let res = response;

        if(response.response && response.status === undefined) {
            res = response.response;
        }

        try {
            this.status = res.status;
            this.statusText = res.statusText;

            // cyclical reference so we need to cherry pick fields
            this.headers = {};

            for(const field of Object.values(ResponseHeaderField)) {
                this.headers[field] = res.headers[field.toLowerCase()];
            }

            this.config = {
                timeout: res.config.timeout,
                xsrfCookieName: res.config.xsrfCookieName,
                xsrfHeaderName: res.config.xsrfHeaderName,
                headers: res.config.headers
            };

            
            delete request.method;
            delete request.baseURL;
            delete request.url;

            this.request = {
                method: res.request.method,
                httpVersion:  res.request.res.httpVersion,
                responseUrl: res.request.res.responseUrl
            };

            this.request = { ...this.request, ...request };

            this.data = res.data;
        } catch {
            throw new Error(response.message);
        }
    }

    json() {
        return {
            status: this.status,
            statusText: this.statusText,
            headers: this.headers,
            config: this.config,
            request: this.request,
            data: this.data
        };
    }

    html() {
        return this.data;
    }

    renderer(): ResponseRendererElements {
        if (!this.status || !this.statusText || this.data === undefined) {
            throw new Error("Corrupt response received! Missing one or more of response status, status text, and/or data!");
        }

        return {
            status: this.status!,
            statusText: this.statusText!,
            headers: this.headers,
            config: this.config,
            request: this.request,
            data: this.data!
        };
    }
}