import { createServer } from "http";
import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import User from "../Models/User";
import Message from "../Models/Message";



dotenv.config();
import { mongo } from "../lib/mongo";
import { CreateTerminal, writeTerminal } from "@/lib/terminal";

const httpServer = createServer();

const io = new Server(httpServer, {
    cors: {
        origin: "https://collaborative-code-editor-s8r7.vercel.app/",
        credentials: true,
    },
});

const projectUsers = new Map<
    string,
    Map<string, { id: string; name: string }>
>();
const onlineUsers = new Map();

io.use((socket, next) => {
    try {

        const cookie = socket.handshake.headers.cookie;

        if (!cookie) {
            console.log("No cookies ");
            return next(new Error("Unauthorised"));
        }

        const token = cookie.split(';').find((row) => row.trim().startsWith("token="))?.split("=")[1];

        if (!token) {
            console.log("token not found");
            return next(new Error("Unauthorized"));
        }
        const JWT_SECRET = process.env.JWT_SECRET
        if (!JWT_SECRET) {
            console.log("JWT_SECRET not found");
            return next(new Error("Server configuration error"));
        }
        const decoded = jwt.verify(token, JWT_SECRET);
        socket.data.user = decoded;
        console.log("reached here");
        next();

    } catch (error) {
        next(new Error("Unauthorized"));
    }
})
function adduser(projectId: string, socketId: string, UserId: string, UserName: string) {
    if (!projectUsers.has(projectId)) {
        projectUsers.set(projectId, new Map());
    }
    projectUsers.get(projectId)!.set(socketId, { id: UserId, name: UserName })
}
function getusers(projectId: string) {

    if (!projectUsers.has(projectId)) return [];

    const usermap = projectUsers.get(projectId)

    const users: { name: string, id: string }[] = [];
    if (usermap === undefined) return []
    for (const [key, value] of usermap) {
        users.push({ name: value.name, id: value.id });
    }
    return users;

}
function removeUser(fileId: string, id: string, socketId: string) {
    if (!projectUsers.has(fileId)) return;

    const usermap = projectUsers.get(fileId);
    if (!usermap) return;
    usermap.delete(socketId);
    if (usermap.size === 0) {
        projectUsers.delete(fileId);
    }
}
io.on("connection", async (socket) => {

    console.log("client connected", socket.id);
    console.log("data = ", socket.data.user);

    let currProjectId: string | null = null;
    let UserName: string | any = "Unknown"
    let UserId = socket.data.user?.id;
    onlineUsers.set(UserId, socket.id);

    if (socket.data.user?.id) {
        try {

            const DBdata = await User.findById(socket.data.user.id).select("name");
            console.log("mongoData = ", DBdata)
            if (DBdata) {
                UserName = DBdata.name;
                console.log("userName  =", UserName)
                console.log("id  =", DBdata._id.tostring());
            }
            else console.log("User not found in DB");

        } catch (error) {
            console.error("Error fetching user:", error);
        }
    }
    else {
        console.log("No user ID found");
    }

    socket.on("code-change", ({ fileId, projectId, code }) => {
        console.log("data = ", fileId, code);
        socket.to(projectId).emit("code-update", { code, fileId })
    })
    socket.on("cursor-move", ({ projectId, fileId, position }) => {
        if (!fileId || !projectId) {
            console.log("id cursor move me nahi ayye");;
            socket.emit("error", { message: "id is req" });
        }
        console.log("position === ", position)
        console.log("fileId = ", fileId);
        console.log("projectId = ", projectId);
        socket.to(projectId).emit("cursor-update", {
            userId: UserId,
            fileId: fileId,
            position,
        })

    })
    socket.on("joined", (id: string) => {

        if (!id) {
            console.log(" project ID nahi aye");

            socket.emit("error", { message: "Project ID is required" });
            return;

        }

        currProjectId = id;
        socket.join(id)

        console.log(`${socket.id} joined ${id}`)

        if (UserId)
            adduser(id, socket.id, UserId, UserName);

        io.to(id).emit("user-joined",
            {
                userId: UserId,
                name: UserName,
            }
        )

        const users = getusers(id);
        console.log("users===", users);

        const user = io.sockets.adapter.rooms.get(id);
        const UserCount = user ? user.size : 0;

        console.log("count = ", UserCount)


        io.to(id).emit("online-members", users)

        const terminal = CreateTerminal(id);

        terminal.output.on("data", (data: string) => {
            console.log("😭😭", data)
            socket.emit("terminal-output", data);
        })

        terminal.output.on("exit", (code: number) => {
            socket.emit("terminal-exit", code);
        })



    })
    socket.on("selction-change", ({ projectId, fileId, selection }) => {
        console.log("selction-change ")
        console.log("selction-change slectin =  ", selection)
        console.log("ids =  ", UserId, fileId)
        socket.to(projectId).emit("selection-update", {
            userId: UserId,
            fileId: fileId,
            selection
        })
    })
    socket.on("file-opened", ({ projectID, fileId }) => {
        console.log("file Opened", fileId, projectID);
        socket.to(projectID).emit("user-file-changed", { userId: UserId, fileId })
    })

    socket.on("send-message", async ({ projectId, message }) => {

        try {
            const newMessage = await Message.create({
                projectId,
                userId: UserId,
                message,
            })

            io.to(projectId).emit("new-message", {
                userId: UserId,
                message: message,
                userName: UserName,
                time: new Date(),
            })

        } catch (error) {
            console.error(
                "MESSAGE ERROR:",
                error
            );
            throw new Error("cant save in server req message");
        }

    })
    socket.on("user-left", ({ projectId }) => {
        console.log("😡😡")
        if (!projectId) return;
        removeUser(projectId, UserId, socket.id);
        socket.leave(projectId);
        const user = getusers(projectId);

        io.to(projectId).emit("online-members", user);

    })

    socket.on("terminal-input", ({ projectId, command }) => {

        writeTerminal(projectId, command);
    })
    socket.on("call-user", ({ projectId, callerId, callerName, targetUserId, targetUserName }) => {
        const targetSocketId = onlineUsers.get(targetUserId);
        if (targetSocketId) {
            io.to(targetSocketId).emit("incoming-call", {
                callerId,
                callerName,
                callerSocketId: socket.id,
                projectId
            });
        }
    })
    socket.on("accept-call", ({ callerId, projectId, callerSocketId }) => {
        console.log("accepted req in server")
        io.to(callerSocketId).emit("call-accepted", { reciverSocketId: socket.id })
    })
    socket.on("reject-call", ({ callerId, projectId }) => {
        io.to(callerId).emit("call-rejected")
    })
    socket.on("offer", ({ offer, reciverSocketId }) => {
        io.to(reciverSocketId).emit("offer", { offer, callerId: socket.id })
    })
    socket.on("answer", ({ answer, callerId }) => {
        io.to(callerId).emit("answer", { answer, callerId: socket.id })
    })
    socket.on("ice-candidate", ({ candidate, targetId }) => {

        io.to(targetId).emit("ice-candidate", {
            candidate
        });

    })

    socket.on("file-created", ({ projectId }) => {
        console.log("prject created")
        io.to(projectId).emit("refresh-files");
    })
    socket.on("delete-file", ({ projectId }) => {
        io.to(projectId).emit("refresh-files")
    })
    socket.on("rename-file", ({ projectId }) => {
        io.to(projectId).emit("refresh-files")
    })
    socket.on("disconnect", () => {

        try {
            if (!currProjectId) return;
            console.log("user disconnected", socket.id);

            const usermap = projectUsers.get(currProjectId);
            if (usermap === undefined) return;
            usermap.delete(socket.id)

            const onlineUsers = Array.from(usermap.values())

            console.log("left = ", onlineUsers)
            io.to(currProjectId).emit("online-members", onlineUsers)
            if (usermap.size === 0) {
                projectUsers.delete(currProjectId)
            }
        } catch (error) {
            console.error("DISCONNECT ERROR:", error);
        }

    })

})

async function startServer() {
    await mongo();
    const PORT = Number(process.env.PORT) || 3002;
    httpServer.listen(PORT, () => {
        console.log(`Socket server running on ${PORT}`);
    });
}

startServer();