import { RequestParser } from './request';
export interface ResponseRendererElements {
    status: number;
    statusText: string;
    headers?: any | undefined;
    config?: any | undefined;
    request?: any | undefined;
    data: any;
}
export declare class ResponseParser {
    private status;
    private statusText;
    private headers;
    private config;
    private request;
    private data;
    private reqParser;
    constructor(response: any, request: any, reqParser: RequestParser);
    json(): {
        status: number | undefined;
        statusText: string | undefined;
        headers: any;
        config: any;
        request: any;
        data: any;
    };
    html(): any;
    renderer(): ResponseRendererElements;
}
