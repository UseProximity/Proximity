import { NextResponse } from "next/server";
import { auth } from "@/auth";
import connectMongo from "@/libs/mongoose";
import User from "@/models/User";

export async function PATCH(req) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    // allow only safe fields
    const allowed = {
      name: body.name,
      phone: body.phone,
      description: body.description,
      gender: body.gender,
      profileComplete: body.profileComplete,
      ...(body.image !== undefined && { image: body.image }),
    };

    // only add role if it's explicitly provided
    if (body.role !== undefined && body.role !== null) {
      allowed.role = body.role;
    }

    if (body.birthday !== undefined && body.birthday !== null) {
      const parsed = new Date(body.birthday);
      if (!isNaN(parsed.getTime())) allowed.birthday = parsed;
    }

    await connectMongo();
    const updated = await User.findByIdAndUpdate(
      session.user.id,
      { $set: allowed },
      { new: true, lean: true }
    );

    if (!updated) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    return NextResponse.json(updated);
  } catch (e) {
    console.error("PATCH /api/user/profile failed:", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
