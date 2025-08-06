import connectMongo from "@/libs/mongoose";
import User from "@/models/User";

export async function GET() {
  const fixedUserId = "68877696221d6bb66c4c7c7d"; //For now fixed User
  try {
    await connectMongo();

    const user = await User.findById(fixedUserId).lean();
    if (!user) {
      return Response.json({ error: "User not found" }, { status: 404 });
    }
    // Convert non-serializable fields (ObjectId, Date, etc.)
    const safeUser = {
      ...user,
      _id: user._id.toString(),
      createdAt: user.createdAt?.toISOString() || null,
      updatedAt: user.updatedAt?.toISOString() || null,
    };

    return Response.json(safeUser);
  } catch (error) {
    console.error("Error fetching user:", error);
    return Response.json({ error: "Failed to fetch user" }, { status: 500 });
  }
}
