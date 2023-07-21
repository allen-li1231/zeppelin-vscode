# Zeppelin Extension for Visual Studio Code

A [Visual Studio Code](https://code.visualstudio.com/) extension that provides basic notebook support for language kernels that are supported in [Zeppelin Notebooks](https://zeppelin.apache.org/) today. This is _**NOT a Zeppelin Server or language kernel**_--you must have an Zeppelin Server 0.8.0 or afterwards for note to run properly in VS Code.

## Features
* Zeppelin notebook file rendered in VS Code, just like juypter notebook does.
* Paragraph runnable in notebook by communicating with Zeppelin server.
* Local changes automatically synced with server.

## How to Use
* Install Zeppelin VS Code Extension.
* Download Zeppelin notebook file (either .json or .zpln) from Zeppelin web server.
* Rename file suffix into ".zpln" if it is ".json".
* Open it using VS Code, during first cell run you will be prompted to provide server url and credential.
* More configurations can be accessed by searching for 'zeppelin' in setting or command palette.

## Contribution
__The extension is currently under personal development. If you would like to develop with me, please fire an issue.__

## Feedback
__Desperately needed! Please do report bugs or advise any improvement by firing issues.__