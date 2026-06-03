# vTally Hub

This is the code that runs on a computer in your network and communicates with 
your video mixer and the Tallies. It also offers a web interface for monitoring
and configuration.

[Full documentation at wifi-tally.github.io](https://wifi-tally.github.io/)

## SunjooAN v1.5.0 notes

This repository is maintained as the SunjooAN OBS tally package at
`sunjoo1968-design/OBS-tally`.

Version 1.5.0 focuses on vMix Mix input responsiveness and Windows packaging:

* vMix Mix input XML polling is reduced to 250ms.
* vMix `TALLY OK` events trigger an immediate XML refresh with rate limiting.
* TCP responses are buffered before command parsing, which makes fragmented XML
  responses safer to process.
* vMix reconnect now creates a new socket instead of reusing a closed socket.
* The web header shows `made by SunjooAN` and `V1.5.0`.

## Development setup

### Overview

The code consists of two parts

* The **backend**, a nodeJS application
* The **frontend**, built with ReactJS

Both share some of the code and live in the same directory structure.

### Run the development setup

Both parts, _frontend_ and _backend_, have to be started. During development the _backend_
proxies requests to the _frontend_.

    npm install --also=dev

    # in one terminal
    npm run start:frontend

    # in another terminal
    npm run start:backend

Point your browser to http://localhost:3000

### Run tests

Before pushing you should run the tests with

    npm run test

For the vMix connector check used in v1.5.0:

    npm run build:backend
    npm test -- --watchAll=false --runInBand VmixConnector

### Editor

Use of [Visual Studio Code](https://code.visualstudio.com/) with the following extensions is recommended:

* ESLint

#### Troubleshoot "Cannot use JSX unless the '--jsx' flag is provided"

    Cannot use JSX unless the '--jsx' flag is provided

VS Code might underline most of the inputs red and complain with the above message

The [solution](https://stackoverflow.com/a/64976666)
is to [make VS Code use the workspace's version of Typescript](https://code.visualstudio.com/docs/typescript/typescript-compiling#_using-the-workspace-version-of-typescript).

## Concepts

### Sockets

Frontend-Backend communication is done through a websocket. It is the default way of sharing data and should be preferred over
an HTTP API or similar.
