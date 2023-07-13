# Zeppelin Extension for Visual Studio Code

A [Visual Studio Code](https://code.visualstudio.com/) extension that provides basic notebook support for language kernels that are supported in [Zeppelin Notebooks](https://zeppelin.apache.org/) today. This is _**NOT a Zeppelin Server or language kernel**_--you must have an Zeppelin Server 0.8.0 or afterwards for note to run properly in VS Code.

## Features
* Zeppelin notebook file rendered in VS Code, just like juypter notebook does.
* Paragraph runnable in notebook by communicating with Zeppelin server.
* Local changes automatically synced with server.

## How to Use
* install Zeppelin VS Code Extension.
* download Zeppelin notebook file (either .json or .zpln) from Zeppelin web server.
* rename file suffix into ".zpln" if it is ".json".
* open it using VS Code, during first cell run you will be prompted to provide server url and credential.
* you may access more configurations by searching 'zeppelin' in settings or commands.

## Contribution
__The extension is currently under personal development. If you would like to develop with me, please fire an issue.__