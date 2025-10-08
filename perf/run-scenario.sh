#!/bin/sh
npm install -g artillery-plugin-statsd
npm run artillery -- run $1 -e $2
