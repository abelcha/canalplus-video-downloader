#!/usr/bin/env node
var Download = require('./bin/index.js')
var ids = process.argv.slice(2);

if (ids.length < 1) {
    console.log('usage: canalplus [video_id]');
    process.exit();
}

Download(ids)
