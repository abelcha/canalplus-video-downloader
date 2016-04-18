'use strict';

const async = require('async')
const request = require('request')
const exec = require('child_process').exec;
const colour = require('colour');
const _ = require('lodash')
const path = require('path');
const uuid = require('uuid');
const ProgressBar = require('progress')
const parseXml = require('xml2js').parseString;
const fs = require('fs');
const PLAYER_URL = "http://service.canal-plus.com/video/rest/getVideos/cplus/"


module.exports = function(ids) {

    const bar = new ProgressBar('  downloading [:bar] :percent :etas', {
        complete: '=',
        incomplete: ' ',
        width: 50,
        total: ids.length
    });

    async.eachLimit(ids, 10, (videoId, big_callback) => {
        async.waterfall([
            function getVideoInfo(callback) {
                request.get(PLAYER_URL + videoId, (err, resp, body) => {
                    parseXml(body, {
                        normalizeTags: true,
                        mergeAttrs: true
                    }, (err, xml) => {
                        try {
                          let info = xml.videos.video[0].infos[0];
                          let media = xml.videos.video[0].media[0]
                          let rtn = {}
                          rtn.date = info.publication[0].date[0].replace(/\//g, '-')
                          rtn.title = info.titrage[0].titre[0]
                          rtn.subTtitle = info.titrage[0].sous_titre[0]
                          rtn.playlistURL = media.videos[0].hls[0]
                          callback(null, rtn)
                        } catch (e) {
                          return callback(`[ERROR] - VIDEO '${videoId}' DOES NOT EXIST`.red);
                        }

                    })
                })
            },
            function getVideoUrl(info, callback) {
                // QUICKER WAY
                callback(null, _.set(info, 'segmentsUrl', info.playlistURL.replace('master', 'index_3_av')))

                // request.get(info.playlistURL, (err, resp, body) => {
                //         let segmentsUrl = body.split('\n').filter(e => e.includes('index_3_av.m3u8'))
                //         if (!segmentsUrl || !segmentsUrl[0]) {
                //           return callback('[ERROR] no video found');
                //         }
                //         callback(null, )
                //     })
            },
            function getSegmentsUrl(info, callback) {
                request.get(info.segmentsUrl, (err, resp, body) => {
                    let files = body.split('\n').filter(e => e.startsWith('http'))
                    if (!files && !files.length) {
                        return callback('[ERROR] no segments found')
                    }
                    callback(null, _.set(info, 'files', files))
                })
            },
            function createTmpFolder(info, callback) {
                info.filename = `${info.date} - ${info.title}`;
                info.fullname = `${info.date} - ${info.title}.mp4`;
                info.fileDest = path.join('/tmp', info.filename)
                fs.mkdir(info.fileDest, (err, folder) => callback(null, info))
            },
            function downloadSegments(info, callback) {
                console.time('download ' + info.filename)
                async.eachLimit(info.files, 10, (file, cb) => {
                    let stream = fs.createWriteStream(path.join(info.fileDest, path.basename(file)));
                    let totalLength = 0;
                    request.get(file)
                        .on('response', resp => totalLength = resp.headers['content-length'])
                        .on('data', chunk => bar.tick((1 / info.files.length) * (chunk.length / totalLength)))
                        .on('end', () => {
                            cb(null)
                        })
                        .pipe(stream)
                }, () => {
                    // console.timeEnd('download ' + info.filename)
                    callback(null, info)
                })
            },
            function mergeSegments(info, callback) {
                if (fs.existsSync(info.fullname)) {
                    fs.unlinkSync(info.fullname)
                }
                const files = info.files.map(file => path.join(info.fileDest, path.basename(file)))
                const command = [
                    "ffmpeg",
                    "-i",
                    `"concat:${files.join('|')}"`,
                    "-c",
                    "copy",
                    "-bsf:a",
                    "aac_adtstoasc",
                    `"${info.fullname}"`
                ].join(' ')
                exec(command, (error, stdout, stderr) => {
                    callback(null, info)
                });
            },
            function setDate(info, callback) {
                fs.open(info.fullname, 'r', (err, fd) => {
                    let date = new Date(info.date.split('-').map(e => parseInt(e)).reverse())
                    fs.futimes(fd, date, date, function(err, resp) {
                        callback(null)
                    });
                })

            }
        ], function(err, resp) {
          if (err) {
            console.log(err)
          }
          big_callback(null)
        });
    })
}
