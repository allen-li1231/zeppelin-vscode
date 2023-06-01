export const DEBUG_MODE = true;

export const NAME = 'zeppelin-notebook';
// export const MIME_TYPE = 'x-application/zeppelin-notebook';


export function formatURL(url: string): string {
    if(!url.startsWith('http')) {
        return `http://${url}`;
    } 
    return url;
}


export function logDebug(item: string | any, ...optionalParams: any[]) {
    if (DEBUG_MODE) {
        console.log(item, optionalParams);
    }
}


export let mapLanguageKind = new Map<string, number>();
mapLanguageKind.set("markdown", 1);
mapLanguageKind.set("python", 2);
mapLanguageKind.set("scala", 2);
mapLanguageKind.set("r", 2);
mapLanguageKind.set("sql", 2);