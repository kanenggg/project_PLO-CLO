import { Router } from "express";
import { authenticateToken } from "../middleware/authMiddleware";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const router = Router();

// 1. GET: Fetch Grade Settings by Semester ID
router.get("/settings/:semesterId", authenticateToken, async (req, res) => {
  try {
    const semesterId = parseInt(req.params.semesterId as string);

    if (isNaN(semesterId)) {
      return res.status(400).json({ error: "Invalid Semester ID" });
    }

    const settings = await prisma.gradeSetting.findMany({
      // 🟢 เปลี่ยนจาก course_id เป็น semester_id (อ้างอิงตามชื่อฟิลด์ใน Schema ของคุณ)
      where: { semester_id: semesterId },
      orderBy: { score: "desc" },
    });

    res.json(settings);
  } catch (err) {
    console.error("Fetch Grade Settings Error:", err);
    res.status(500).json({ error: "Failed to fetch grade settings" });
  }
});

// 2. POST: Bulk Update Grade Settings by Semester ID
router.post("/settings", authenticateToken, async (req, res) => {
  try {
    const { semesterId, settings } = req.body;

    // Validation
    if (!semesterId || !Array.isArray(settings)) {
      return res.status(400).json({
        error:
          "Invalid input data. semesterId and settings array are required.",
      });
    }

    // 🟢 TRANSACTION: ลบเกณฑ์เดิมของเทอมนี้ แล้วบันทึกใหม่
    await prisma.$transaction(async (tx) => {
      // A. ลบข้อมูลเดิมเฉพาะของ Semester นี้
      await tx.gradeSetting.deleteMany({
        where: { semester_id: Number(semesterId) },
      });

      // B. กรองเฉพาะข้อมูลที่ถูกต้อง
      const validSettings = settings.filter(
        (s: any) => s.score !== "" && s.score !== null && s.grade,
      );

      if (validSettings.length > 0) {
        await tx.gradeSetting.createMany({
          data: validSettings.map((item: any) => ({
            semester_id: Number(semesterId),
            grade: item.grade,
            score: Number(item.score), // มั่นใจว่าเป็น Number เพื่อเก็บเข้า Decimal/Float
          })),
        });
      }
    });

    // Fetch ข้อมูลที่อัปเดตแล้วส่งกลับไปให้ Frontend
    const updatedSettings = await prisma.gradeSetting.findMany({
      where: { semester_id: Number(semesterId) },
      orderBy: { score: "desc" },
    });

    res.json({
      message: "Grade settings updated successfully for this semester",
      updatedSettings,
    });
  } catch (err: any) {
    console.error("Error updating grade settings:", err);
    res
      .status(500)
      .json({ error: "Failed to update grade settings", details: err.message });
  }
});

router.delete("/settings/bulk", authenticateToken, async (req, res) => {
  try {
    const { semesterId } = req.body;

    if (!semesterId) {
      return res.status(400).json({ error: "semesterId is required" });
    }

    await prisma.gradeSetting.deleteMany({
      where: { semester_id: Number(semesterId) },
    });

    res.json({ message: "All grade settings deleted for this semester" });
  } catch (err) {
    console.error("Error deleting grade settings:", err);
    res.status(500).json({ error: "Failed to delete grade settings" });
  }
});

export default router;
