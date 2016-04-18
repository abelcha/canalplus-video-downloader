'use strict';

var async = require('async');
var request = require('request');
var exec = require('child_process').exec;
var colour = require('colour');
var _ = require('lodash');
var path = require('path');
var uuid = require('uuid');
var ProgressBar = require('progress');
var parseXml = require('xml2js').parseString;
var fs = require('fs');
var PLAYER_URL = "http://service.canal-plus.com/video/rest/getVideos/cplus/";

module.exports = function (ids) {

    var bar = new ProgressBar('  downloading [:bar] :percent :etas', {
        complete: '=',
        incomplete: ' ',
        width: 50,
        total: ids.length
    });

    async.eachLimit(ids, 10, function (videoId, big_callback) {
        async.waterfall([function getVideoInfo(callback) {
            request.get(PLAYER_URL + videoId, function (err, resp, body) {
                parseXml(body, {
                    normalizeTags: true,
                    mergeAttrs: true
                }, function (err, xml) {
                    try {
                        var info = xml.videos.video[0].infos[0];
                        var media = xml.videos.video[0].media[0];
                        var rtn = {};
                        rtn.date = info.publication[0].date[0].replace(/\//g, '-');
                        rtn.title = info.titrage[0].titre[0];
                        rtn.subTtitle = info.titrage[0].sous_titre[0];
                        rtn.playlistURL = media.videos[0].hls[0];
                        callback(null, rtn);
                    } catch (e) {
                        return callback(('[ERROR] - VIDEO \'' + videoId + '\' DOES NOT EXIST').red);
                    }
                });
            });
        }, function getVideoUrl(info, callback) {
            // QUICKER WAY
            callback(null, _.set(info, 'segmentsUrl', info.playlistURL.replace('master', 'index_3_av')));

            // request.get(info.playlistURL, (err, resp, body) => {
            //         let segmentsUrl = body.split('\n').filter(e => e.includes('index_3_av.m3u8'))
            //         if (!segmentsUrl || !segmentsUrl[0]) {
            //           return callback('[ERROR] no video found');
            //         }
            //         callback(null, )
            //     })
        }, function getSegmentsUrl(info, callback) {
            request.get(info.segmentsUrl, function (err, resp, body) {
                var files = body.split('\n').filter(function (e) {
                    return e.startsWith('http');
                });
                if (!files && !files.length) {
                    return callback('[ERROR] no segments found');
                }
                callback(null, _.set(info, 'files', files));
            });
        }, function createTmpFolder(info, callback) {
            info.filename = info.date + ' - ' + info.title;
            info.fullname = info.date + ' - ' + info.title + '.mp4';
            info.fileDest = path.join('/tmp', info.filename);
            fs.mkdir(info.fileDest, function (err, folder) {
                return callback(null, info);
            });
        }, function downloadSegments(info, callback) {
            console.time('download ' + info.filename);
            async.eachLimit(info.files, 10, function (file, cb) {
                var stream = fs.createWriteStream(path.join(info.fileDest, path.basename(file)));
                var totalLength = 0;
                request.get(file).on('response', function (resp) {
                    return totalLength = resp.headers['content-length'];
                }).on('data', function (chunk) {
                    return bar.tick(1 / info.files.length * (chunk.length / totalLength));
                }).on('end', function () {
                    cb(null);
                }).pipe(stream);
            }, function () {
                // console.timeEnd('download ' + info.filename)
                callback(null, info);
            });
        }, function mergeSegments(info, callback) {
            if (fs.existsSync(info.fullname)) {
                fs.unlinkSync(info.fullname);
            }
            var files = info.files.map(function (file) {
                return path.join(info.fileDest, path.basename(file));
            });
            var command = ["ffmpeg", "-i", '"concat:' + files.join('|') + '"', "-c", "copy", "-bsf:a", "aac_adtstoasc", '"' + info.fullname + '"'].join(' ');
            exec(command, function (error, stdout, stderr) {
                callback(null, info);
            });
        }, function setDate(info, callback) {
            fs.open(info.fullname, 'r', function (err, fd) {
                var date = new Date(info.date.split('-').map(function (e) {
                    return parseInt(e);
                }).reverse());
                fs.futimes(fd, date, date, function (err, resp) {
                    callback(null);
                });
            });
        }], function (err, resp) {
            if (err) {
                console.log(err);
            }
            big_callback(null);
        });
    });
};