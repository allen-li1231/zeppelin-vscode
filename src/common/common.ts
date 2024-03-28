import { ExtensionContext, workspace } from "vscode";
import { AxiosProxyConfig } from 'axios';

export const DEBUG_MODE = true;

export const EXTENSION_NAME = 'zeppelin-notebook';
export const NOTEBOOK_SUFFIX = '.zpln';

export const SUPPORTEDLANGUAGE = [
    'plaintext', 'cypher', 'sql-bigquery', 'cassandra', 'es', 'flink-sql',
    'geode', 'groovy', 'gsp', 'hazelcastjet', 'hbase', 'hive-sql', 'hql', 'ignite',
    'influxdb', 'java', 'javascript', 'json', 'jsonl', 'jsonc', 'kotlin', 'ksql', 'kylin',
    'mahout', 'markdown', 'lua', 'pig', 'plsql', 'python', 'r', 'sap', 'scala', 'scalding',
    'scio', 'shellscript', 'spark', 'sql', 'xml'];

export const mapLanguageKind = new Map<string, number>();
for (let lang of SUPPORTEDLANGUAGE) {
    mapLanguageKind.set(lang, 2);
}
mapLanguageKind.set('markdown', 1);

// ref: https://github.com/apache/zeppelin/blob/8b8848ad82423eb5a56d93ec1e94a146f36754c2/zeppelin-web-angular/projects/zeppelin-sdk/src/interfaces/message-common.interface.ts#L22
export const mapLanguage = new Map<string, string>([
    ['', "plaintext"],
    ["groovy", "groovy"],
    ["java", "java"],
    ["javascript", "javascript"],
    ["json", "json"],
    ["kotlin", "kotlin"],
    ["lua", "lua"],
    ["scala", "scala"],
    ["python", "python"],
    ["r", "r"],
    ["sql", "sql"],
    ["markdown", "markdown"],
    ["pig", "pig"],
    ["sh", "shellscript"],
    ["xml", "xml"]
]);

// ref: https://github.com/ajaxorg/ace-builds/blob/8618dae255e5b1bc6bc9ab16c5f4ff82c81f13e4/esm-resolver.js
export const mapZeppelinLanguage = new Map<string, string>([
    ['plaintext', "plain_text"],
    ["cypher", "plain_text"],
    ["sql-bigquery", "sql"],
    ["cassandra", "sql"],
    ["es", "plain_text"],
    ["flink-sql", "sql"],
    ["geode", "sql"],
    ["groovy", "groovy"],
    ["hazelcastjet", "sh"],
    ["hive-sql", "sql"],
    ["hql", "sql"],
    ["influxdb", "sql"],
    ["java", "java"],
    ["javascript", "javascript"],
    ["json", "json"],
    ["jsonl", "json"],
    ["jsonc", "json"],
    ["kotlin", "kotlin"],
    ["ksql", "sql"],
    ["lua", "lua"],
    ["mahout", "r"],
    ["markdown", "markdown"],
    ["pig", "pig"],
    ["python", "python"],
    ["r", "r"],
    ["sap", "plain_text"],
    ["scala", "scala"],
    ["shellscript", "sh"],
    ["sql", "sql"],
    ["xml", "xml"]
]);

export const reInterpreter = RegExp(/[\s\n]*%([\w\d\._]+)\s*\n+/);
export const reURL = RegExp(/[-a-zA-Z0-9@:%._\+~#=]{1,256}\.?[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)?/gi);
export const reCookies = RegExp(/^(JSESSIONID=((?!deleteMe).)*?);/s);
export const reBase64= /^([0-9a-zA-Z+/]{4})*(([0-9a-zA-Z+/]{2}==)|([0-9a-zA-Z+/]{3}=))?$/;

export function getVersion(context: ExtensionContext) {
    return context.extension.packageJSON.version;
}

export function formatURL(url: string): string {
    if(!url.startsWith('http')) {
        return `http://${url}`;
    } 
    return url;
}

export function logDebug(item: string | any, ...optionalParams: any[]) {
    if (DEBUG_MODE) {
        console.log(`Zeppelin ${item}`, optionalParams);
    }
}

export function getProxy() {
    let proxy: AxiosProxyConfig | undefined = undefined;

    let config = workspace.getConfiguration('zeppelin');
    if (!!config.get('proxy.host') && !!config.get('proxy.port')) {
        proxy = {
            host: config.get('proxy.host', ''),
            port: config.get('proxy.port', 0),
            protocol: config.get('proxy.protocol')
        };
        if (!!config.get('proxy.credential.username')) {
            proxy["auth"] = {
                username: config.get('proxy.credential.username', ''),
                password: config.get('proxy.credential.password', '')
            };
        }
    }
    return proxy;
}