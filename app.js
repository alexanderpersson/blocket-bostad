/**
 * Created by Alexander Persson on 2015-04-20.
 */

var util        = require('util'),
    request     = require('request'),
    _           = require('lodash'),
    q           = require('q'),
    chokidar    = require('chokidar'),
    requirenew  = require('require-new'),
    cheerio     = require('cheerio'),
    nodemailer  = require('nodemailer'),
    fs          = require('fs'),
    watchlist   = [],
    config      = null,
    timer       = null,
    firstRun    = true,
    log         = 'data.json'

function createFileWatcher() {
    var fileWatcher = chokidar.watch('config.json')
    fileWatcher.on('add', function(path) {
        readConfig()
    })
    fileWatcher.on('change', function(path) {
        readConfig()
    })
}

function readConfig() {
    //TODO add try catch if json is invalid
    var oldTimeout = 0
    if (config != null)
        oldTimeout = config.intervalInMinutes

    config = requirenew('./config')
    util.log(JSON.stringify(config))

    updateTimer(oldTimeout, config.intervalInMinutes)
}

function updateTimer(oldTimeout, newTimeout) {
    if (oldTimeout === newTimeout)
        return

    if (timer != null)
        clearInterval(timer)

    timer = setInterval(timerInit, newTimeout * 60 * 1000)
    if (firstRun) {
        firstRun = false
        timerInit()
    }
}

function timerInit() {
    util.log('tick')

    _.forEach(config.watchlist, function(item) {
       downloadRaw(item).then(parseItems).then(getNewItems).then(sendMail).then(saveData)
    })
}

function downloadRaw(url) {
    var deferred = q.defer()
    request(url, function(error, response, body) {
        if (!error && response.statusCode === 200) {
            var html = body.toString()
            deferred.resolve(html)
        }
        else {
            deferred.reject(error)
        }
    })
    return deferred.promise
}

function parseItems(html) {
    return q.fcall(function() {
        var $ = cheerio.load(html)
        var htmlItems = $('div[itemtype="http://schema.org/Offer"]')

        var items = []
        _.forEach(htmlItems, function(item) {
            var $ = cheerio.load(item)
            var blocketItem = {}

            blocketItem.category = $('.category').text().trim()
            blocketItem.city = $('.address').text().trim()
            blocketItem.header = $('.item_link').text().trim()
            blocketItem.rent = $('.monthly_rent').text().trim()
            blocketItem.rooms = $('.rooms').text().trim()
            blocketItem.size = $('.size').text().trim()
            blocketItem.date = $('.jlist_date_image').attr('datetime')
            blocketItem.link = $('a').attr('href')

            items.push(blocketItem);
        })

        return items
    })
}

function getNewItems(items) {
    return q.fcall(function () {
        var newItems = []
        _.forEach(items, function(item) {
            var exists = _.some(watchlist, 'link', item.link)
            if (!exists) {
                newItems.push(item)
                util.log(item.header)
            }
        })
        return newItems
    })
}

function sendMail(newItems) {
    return q.fcall(function () {
        if (newItems.length === 0) {
            return newItems
        }

        var html = '<html>'
        _.forEach(newItems, function(item) {
            html += '<b>' + item.header + '</b><br />'
            html += item.category + ' i ' + item.city + ' <br />'
            html += 'Antal rum: ' + item.rooms + '<br />'
            html += 'Storlek: ' + item.size + '<br />'
            html += 'Hyra: ' + item.rent + 'kr/mån <br />'
            html += 'Datum: ' + item.date + '<br />'
            html += item.link + ' <br /><br /><br />'
        })
        html += '</html>'

        var message = {
            html: html,
            from: config.smtp.emailAddress,
            to: config.recievers.toString(', '),
            subject: 'Nya blocketannonser'
        }

        var emailServer = nodemailer.createTransport({
            service: 'Gmail',
            auth: {
                user: config.smtp.emailAddress,
                pass: config.smtp.password
            }
        })

        emailServer.sendMail(message, function(err, msg) {
            util.log(err || msg.response)
        })

        return newItems
    })
}

function saveData(newItems) {
    _.forEach(newItems, function(item) {
        watchlist.push({link: item.link})
    })

    var json = JSON.stringify(watchlist)
    fs.writeFile(log, json, 'utf8', function(err) {
        if (err) {
            util.log(err)
        }
    })
}

function start() {
    fs.readFile(log, 'utf8', function(err, data) {
        if (err) {
            fs.open(log, 'w', function(err, fd) {
               if (err) {
                   util.log(err)
               }
            })
        }
        else {
            watchlist = JSON.parse(data)
        }
    })

    createFileWatcher()
}

start()