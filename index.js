require('dotenv').config();
const { v4: uuidv4 } = require('uuid');
const express = require('express');
const formidable = require('formidable');
const fs = require('fs');
const pug = require("pug");
const app = express();
var path = require('path');
var ffmpeg = require('fluent-ffmpeg');
var logger = require("log4js").getLogger();
logger.level = process.env.LOGGING_LEVEL || "info";
const IP = process.env.IP || "localhost";
const PORT = process.env.PORT || 3000;
var rooms = {};

app.use(require('cookie-parser')());
app.use(require('body-parser').urlencoded({
    extended: true
}));
app.use(require('body-parser').json());
app.set('views', './views');
app.set('view engine', 'pug');
app.use(express.static('public'));
app.use(function (req, res, next) {
    res.header("Access-Control-Allow-Origin", "*");
    logger.debug(`User ${req.cookies.username || "UNNAMED"}(${req.ip}) with UUID ${req.cookies.uuid || "'NONE'"} connected to room ${req.cookies.roomId || "'NONE'"} requested page '${req.originalUrl}'`)
    next();
});

var server = app.listen(PORT, () => {
    logger.info("Server started http://" + IP);
});

const io = require("socket.io")(server, {
    cors: {
        "origin": "*",
        "methods": "GET,HEAD,PUT,PATCH,POST,DELETE",
        "preflightContinue": false,
        "optionsSuccessStatus": 204
    }
});

io.on("connection", socket => {
    var roomId = socket.handshake.query.roomUuid;
    socket.join(roomId);
    socket.on("hostState", (state) => {
        io.to(roomId).emit("state", state);
    })
});

app.get('/', (req, res) => {
    var uuid = req.cookies.uuid;
    if (uuid) {
        var roomId = req.cookies.roomId;
        if (roomId && rooms[roomId]) {
            res.redirect('/rooms/' + roomId);
        } else {
            res.render("newRoom");
        }
    } else {
        res.render("newUser");
    }

});

app.get('/rooms/:roomId', (req, res) => {
    var roomId = req.params.roomId;
    if (roomId != req.cookies.roomId) {
        res.cookie("roomId", req.params.roomId, { expires: new Date(rooms[roomId].expires) });
    }
    var uuid = req.cookies.uuid;
    if (!(uuid)) {
        res.render("newUser");
    } else if (rooms[roomId]) {
        if (rooms[roomId].host == req.cookies.uuid) {
            vids = [];
            fs.readdirSync(`./rooms/${roomId}/`).forEach(file => {
                filename = file.replace(/\.[^/.]+$/, "");
                logger.debug(`Adding ${filename} to list.`);
                vids.push({
                    url: `/rooms/${roomId}/${file}`,
                    name: filename
                })
            });
            logger.debug("Rendering host room with videos: " + vids);
            res.render("hostPlayerRoom", {
                roomId: roomId,
                vids: vids
            });
        } else {
            res.render("playerRoom", {});
        }
    } else {
        res.send("Invalid Room");
    }
});

app.get('/rooms/:roomId/:video', (req, res) => {
    var roomId = req.params.roomId;
    if (req.cookies.roomId != roomId) {
        logger.error(`User ${req.cookies.username || "unnamed"}(${req.ip}) with UUID ${req.cookies.uuid || "'NONE'"} connected to room ${req.cookies.roomId || "'NONE'"} requested '${req.originalUrl}' but has no permission to do so.`)
        logger.warn("Possible exploit of the system.");
        res.status(403).send("Error 403: Access denied");
    }
    fs.access(`./rooms/${req.params.roomId}/${req.params.video}`, fs.constants.R_OK, (err) => {
        if (!err) {
            res.sendFile(__dirname + `/rooms/${req.params.roomId}/${req.params.video}`);
        } else {
            logger.error(`User ${req.cookies.username || "unnamed"}(${req.ip}) with UUID ${req.cookies.uuid || "'NONE'"} connected to room ${req.cookies.roomId || "'NONE'"} requested '${req.originalUrl}' but it is not accessible.`)
            res.status(404).send("Error 404: File not found");
        }
    })
});

app.get('/exit', (req, res) => {
    res.clearCookie("uuid");
    res.clearCookie("username");
    res.clearCookie("roomId");
    res.redirect('/');
});

app.get('/upload/:roomId', (req, res) => {
    res.render("upload", { roomId: req.cookies.roomId });
});

app.post('/api/upload/:roomId', (req, res, next) => {
    const form = formidable({
        multiples: true,
        uploadDir: __dirname + '/rooms/' + req.params.roomId,
        keepExtensions: true
    });
    form.maxFileSize = 16 * 1024 * 1024 * 1024;
    form.parse(req, (err, fields, files) => {
        if (err) {
            next(err);
            return;
        }
        if (Array.isArray(files.videos)) {
            files.videos.forEach((file) => {
                var outputPath = form.uploadDir + "/" + file.name.split(' ').join('_');
                outputPath.substring(0, outputPath.lastIndexOf(".")) + ".mp4";
                var pathToSourceFile = path.resolve(file.path);
                var writeStream = fs.createWriteStream(outputPath, (error) => {
                    logger.debug(error);
                });

                ffmpeg(pathToSourceFile)
                    .addOutputOptions('-movflags +frag_keyframe+separate_moof+omit_tfhd_offset+empty_moov')
                    .format('mp4')
                    .on("start", () => {
                        io.to(roomId).emit("encodeStart")
                    })
                    .on("progress", function (progress) {
                        io.to(roomId).emit("encodeProgress", progress)
                    })
                    .on('end', function (stdout, stderr) {
                        fs.unlink(pathToSourceFile, (err) => {
                            if (err) logger.error(err);
                            else logger.debug("Deleted " + pathToSourceFile + " successfully");
                        });
                        io.to(roomId).emit("encodeEnd")
                    })
                    .pipe(writeStream)
            });
        } else {
            var outputPath = form.uploadDir + "/" + files.videos.name.split(' ').join('_');
            outputPath.substring(0, outputPath.lastIndexOf(".")) + ".mp4";
            var pathToSourceFile = path.resolve(files.videos.path);
            var writeStream = fs.createWriteStream(outputPath, (error) => {
                logger.debug(error);
            });

            ffmpeg(pathToSourceFile)
                .addOutputOptions('-movflags +frag_keyframe+separate_moof+omit_tfhd_offset+empty_moov')
                .format('mp4')
                .on("start", () => {
                    io.to(roomId).emit("encodeStart")
                })
                .on("progress", function (progress) {
                    io.to(roomId).emit("encodeProgress", progress)
                })
                .on('end', function (stdout, stderr) {
                    fs.unlink(pathToSourceFile, (err) => {
                        if (err) logger.error(err);
                        else logger.debug("Deleted " + pathToSourceFile + " successfully");
                    });
                    io.to(roomId).emit("encodeEnd")
                })
                .pipe(writeStream);
        }
    });
    res.redirect("/");
});

app.post('/api/newUser', (req, res) => {
    var uuid = uuidv4();
    var username = req.body.username;
    res.cookie("uuid", uuid);
    res.cookie("username", username);
    res.redirect('/');
});

app.post('/api/newRoom', (req, res) => {
    roomId = uuidv4();
    if (!fs.existsSync("./rooms")) {
        logger.info("Creating rooms folder.")
        fs.mkdirSync("./rooms");
    }
    fs.mkdir('./rooms/' + roomId, (err) => {
        if (err) {
            throw err;
        }
    });
    rooms[roomId] = {
        "host": req.cookies.uuid,
        "expires": Date.now() + 4 * 3600000
    }
    res.cookie("roomId", roomId, { expires: new Date(rooms[roomId].expires) });
    setTimeout(() => {
        fs.rmdir('./rooms/' + roomId, { recursive: true });
        delete rooms[roomId];
    }, 4 * 3600000)
    res.redirect('/rooms/' + roomId);
});
