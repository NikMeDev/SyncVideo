require('dotenv').config()

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

httpServer.listen(process.env.SOCKET_PORT || 3001);