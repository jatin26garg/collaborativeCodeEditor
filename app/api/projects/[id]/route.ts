import { getAuthUser } from "@/lib/auth";
import { NextResponse, NextRequest } from "next/server";
import { mongo } from "@/lib/mongo";
import mongoose from "mongoose";

await mongo();

import User from "@/Models/User";
import Files from "@/Models/Files";
import Projects from "@/Models/Projects";


import { Iuser } from "../route";
import { ProjectResponse } from "../route";
import { checkProjectAccess } from "@/lib/projecthelper";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const authUser = await getAuthUser(req);
        const { id } = await params;
        if (!authUser) {
            return NextResponse.json(
                { success: false, error: "unauthorized" },
                { status: 401 }
            )
        }
        await mongo();

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return NextResponse.json(
                { success: false, error: "invalid ID" },
                { status: 400 }
            )
        }
        const access = await checkProjectAccess(id, authUser.id);
        if (!access) {
            return NextResponse.json(
                {
                    success: false,
                    error: "project does not exist",
                },
                { status: 404 }
            );
        }
        if (!access.hasAccess) {
            return NextResponse.json(
                {
                    success: false,
                    error: "not a valid user",
                },
                { status: 403 }
            );
        }

        const project = await Projects.findById(id).populate("ownerId", "name email").populate("collaborators", "name email");

        if (!project) {
            return NextResponse.json(
                { success: false, error: "project does not exist" },
                { status: 404 },
            )
        }

        const owner = project!.ownerId as any;
        const collaborators = project.collaborators as any[];


        const ProjectResponse: ProjectResponse = {
            id: project._id.toString(),
            name: project.name,
            email: project.email,
            description: project.description,
            owner: {
                id: owner._id.toString(),
                name: owner.name,
                email: owner.email,
            },
            collaborators: collaborators.map((collab: Iuser) => ({
                id: collab._id.toString(),
                name: collab.name,
                email: collab.email
            })
            ),
            createdAt: project.createdAt,
            updatedAt: project.updatedAt,
        }

        return NextResponse.json(
            {
                success: true,
                project: ProjectResponse
            },
            { status: 200 },
        )

    } catch (error) {
        console.log("projects page error === ", error);
        return NextResponse.json(
            { success: false, error: "failed to fetch" },
            { status: 500 },
        )
    }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const authUser = getAuthUser(req);
        const { id } = await params;
        if (!authUser) {
            return NextResponse.json(
                { success: false, error: "Unauthorized" },
                { status: 401 }
            )
        }
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return NextResponse.json(
                { success: false, error: "Invalid project id" },
                { status: 400 }
            );
        }
        await mongo();

        console.log("id = ", id)
        const body = await req.json();
        const projects = await Projects.findById(id);

        if (!projects) {
            return NextResponse.json(
                { success: false, error: "project not found" },
                { status: 404 }
            )
        }
        if (projects.ownerId.toString() !== authUser.id) {
            return NextResponse.json(
                { success: false, erorr: "not a valid owner" },
                { status: 403 }
            )
        }
        const { name, description } = body;
        if (!name?.trim()) {
            return NextResponse.json(
                {
                    success: false,
                    error: "Project name is required"
                },
                { status: 400 }
            );
        }

        projects.name = name;
        projects.description = description;
        projects.updatedAt = Date.now();
        await projects.save();

        return NextResponse.json(
            {
                success: true,
                project: {
                    id: projects._id.toString(),
                    name: projects.name,
                    description: projects.description,
                    updatedAt: projects.updatedAt
                }
            },
            { status: 200 }
        )

    } catch (error) {
        console.log("updated project error = ", error);
        return NextResponse.json(
            { success: false, error: "updation failed" },
            { status: 500 }
        )
    }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const authUser = getAuthUser(req);
        const { id } = await params;
        if (!authUser) {
            return NextResponse.json(
                { success: false, error: "unauthorized" },
                { status: 401 }
            )
        }
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return NextResponse.json(
                { success: false, error: "invalid id" },
                { status: 400 }
            )
        }
        await mongo();

        const projects = await Projects.findById(id);

        if (!projects) {
            return NextResponse.json(
                { success: false, error: "project Not Found" },
                { status: 404 }
            )
        }


        if (projects.ownerId.toString() !== authUser.id) {
            return NextResponse.json(
                { success: false, error: "invalid Id" },
                { status: 403 }
            )
        }

        await Projects.findByIdAndDelete(id);

        return NextResponse.json(
            { success: true, message: "project deleted successfully" },
            { status: 200 }
        )

    } catch (error) {
        console.log("DELete error = ", error);
        return NextResponse.json(
            { success: false, error: "try again later" },
            { status: 500 }
        )
    }
}