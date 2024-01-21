import { ExtensionContext, workspace } from "vscode";
import { AxiosProxyConfig } from 'axios';

export const DEBUG_MODE = true;

export const EXTENSION_NAME = 'zeppelin-notebook';
export const NOTEBOOK_SUFFIX = '.zpln';

export const SUPPORTEDLANGUAGE = [
    'alluxio', 'beam', 'bigquery', 'cassandra', 'elasticsearch', 'flink',
    'geode', 'groovy', 'hazelcastjet', 'hbase', 'hive', 'ignite', 'ignite',
    'influxdb', 'java', 'kotlin', 'ksql', 'kylin', 'mahout', 'markdown',
    'mongodb', 'neo4j', 'pig', 'python', 'r', 'sap', 'scala', 'scalding',
    'scio', 'shell', 'spark', 'sparql', 'sql'];

export const mapLanguageKind = new Map<string, number>();
for (let lang of SUPPORTEDLANGUAGE) {
    mapLanguageKind.set(lang, 2);
}
mapLanguageKind.set('markdown', 1);

export const reInterpreter = RegExp(/([\s\n]*%[\w\d\._]+)\s*\n+/);
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
        console.log(item, optionalParams);
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