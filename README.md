# Zeppelin Extension for Visual Studio Code

A [Visual Studio Code](https://code.visualstudio.com/) extension that provides basic notebook support for language kernels that are supported in [Zeppelin Notebooks](https://zeppelin.apache.org/) today. This is _**NOT a Zeppelin Server or language kernel**_--you must have an Zeppelin Server 0.8.0 or afterwards for note to run properly in VS Code.
Currently the extension development does not consider notebook permission, version control and cron job. If you believe these are important, please fire an issue.

## Features
* Zeppelin notebook file rendered in VS Code, just like juypter notebook does.
* Paragraph runnable (either in sequence or in parallel) in notebook, by communicating with Zeppelin server.
* Local changes automatically synced with server, vice versa.

## How to Use
* Install Zeppelin VS Code Extension.
* Download Zeppelin notebook file (either .json or .zpln) from Zeppelin web server.
* Rename file suffix into ".zpln" if it is ".json".
* Open it using VS Code, during first cell run you will be prompted to provide server url and credential.
* Internally local changes to the notebook are updated to the Zeppelin server in every second,
  your local notebook will be updated to the server version whenever it is opened or activated.
* More configurations can be accessed by searching for 'zeppelin' in setting or command palette.

## Contribution
__The extension is currently under personal development. If you would like to develop with me, please fire an issue.__

## Feedback
__Desperately needed! Please do report bugs or advise any improvement by firing issues.__