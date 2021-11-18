require('dotenv').config();
const { v4: uuidv4 } = require('uuid');
const express = require('express');
const formidable = require('formidable');
const fs = require('fs');
const pug = require("pug");
const app = express();
var logger = require("log4js").getLogger();
logger.level = process.env.LOGGING_LEVEL || "info";
const IP = process.env.IP || "localhost";
const PORT = process.env.PORT || 3000;
const SOCKET_IP = process.env.SOCKET_IP || "localhost";
const SOCKET_PORT = process.env.SOCKET_PORT || 3001;
var rooms = {};

app.use(require('cookie-parser')());
app.use(require('body-parser').urlencoded({
    extended: true
}));
app.use(require('body-parser').json());
app.set('views', './views');
app.set('view engine', 'pug');
app.use(express.static('public'));
app.use(function(req, res, next) {
    res.header("Access-Control-Allow-Origin", "*");
    logger.debug(`User ${req.cookies.username || "unnamed"}(${req.ip}) with UUID ${req.cookies.uuid || "'NONE'"} connected to room ${req.cookies.roomId || "'NONE'"} requested page '${req.originalUrl}'`)
    next();
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
                socketIP: SOCKET_IP,
                socketPort: SOCKET_PORT,
                roomId: roomId,
                vids: vids
            });
        } else {
            res.render("playerRoom", {
                socketIP: SOCKET_IP,
                socketPort: SOCKET_PORT
            });
        }
    } else {
        res.send("Invalid Room");
    }
});

app.get('/rooms/:roomId/:video', (req, res) => {
    var roomId = req.params.roomId;
    if (req.cookies.roomId != roomId) {
        logger.error(`User ${req.cookies.username || "unnamed"}(${req.ip}) with UUID ${req.cookies.uuid || "'NONE'"} connected to room ${req.cookies.roomId || "'NONE'"} requested '${req.originalUrl}' but has no permission to do so.`)
        logger.warn("Possible explot of the system.");
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
    form.maxFileSize = 4 * 1024 * 1024 * 1024;
    form.parse(req, (err, fields, files) => {
        if (err) {
            next(err);
            return;
        }
        if (Array.isArray(files.videos)) {
            files.videos.forEach((file) => {
                fs.rename(file.path, form.uploadDir + "/" + file.name.split(' ').join('_'), (error) => {});
            });
        } else {
            fs.rename(files.videos.path, form.uploadDir + "/" + files.videos.name.split(' ').join('_'), (error) => {})
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

var server = app.listen(PORT, () => {
    logger.info("Server started http://" + IP + ":" + PORT);
});

const httpServer = require("http").createServer();
const io = require("socket.io")(httpServer, {
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

httpServer.listen(SOCKET_PORT);