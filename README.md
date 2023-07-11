# Zeppelin Extension for Visual Studio Code

A [Visual Studio Code](https://code.visualstudio.com/) extension that provides basic notebook support for language kernels that are supported in [Zeppelin Notebooks](https://zeppelin.apache.org/) today. This is _**NOT a Zeppelin Server or language kernel**_--you must have an Zeppelin Server 0.8.0 or afterwards for note to run properly.

## Features
* Zeppelin notebook file rendered in VSCode, just like juypter notebook.
* Paragraph runnable in notebook, and corresponding result will be rendered in cell output.

## How to Use
* install Zeppelin VSCode Extension.
* download Zeppelin notebook file (either .json or .zpln) from Zeppelin web server.
* rename file suffix into ".zpln" if it is ".json".
* open it using VSCode, during first cell run you will be prompted to provide server url and credential.
* you may access more configurations in settings or using commands by searching 'zeppelin'

## Contribution
__The extension is currently under personal development. If you would like to develop with me, please fire an issue.__