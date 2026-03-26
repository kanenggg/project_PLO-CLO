import { Router } from "express";
import { authenticateToken } from "../middleware/authMiddleware";
import { PrismaClient } from "@prisma/client";

const router = Router();
const prisma = new PrismaClient();

// 1. GET: ดึงรายการงาน (Filter by Semester ID)
router.get("/", authenticateToken, async (req, res) => {
  try {
    const semesterId = Number(req.query.semesterId);
    if (!semesterId)
      return res.status(400).json({ error: "semesterId is required" });

    const assignments = await prisma.assignment.findMany({
      where: { semester_id: semesterId },
      orderBy: { createdAt: "asc" },
    });

    res.json(assignments);
  } catch (err: any) {
    res.status(500).json({ error: "Failed to fetch assignments" });
  }
});

router.post("/bulk", authenticateToken, async (req, res) => {
  const { semesterId, assignments } = req.body;

  if (!semesterId || !Array.isArray(assignments)) {
    return res
      .status(400)
      .json({ error: "semesterId and assignments array are required" });
  }

  try {
    // 🟢 ใช้ createMany เพื่อความรวดเร็วและตรงตาม Schema
    const result = await prisma.assignment.createMany({
      data: assignments.map((a: any) => ({
        semester_id: Number(semesterId), // อ้างอิงชื่อฟิลด์ตาม Schema
        name: a.name,
        description: a.description || "",
        category: a.category,
        // Prisma จะจัดการ Decimal ให้เองเมื่อเราส่ง Number เข้าไป
        maxScore: Number(a.maxScore || 100),
        weight: Number(a.weight || 0),
      })),
      skipDuplicates: false, // ถ้าต้องการให้ Error เมื่อมีข้อมูลซ้ำให้เป็น false
    });

    res.json({
      success: true,
      count: result.count,
      message: `Successfully imported ${result.count} assignments`,
    });
  } catch (err: any) {
    console.error("Bulk Insert Error:", err);
    res
      .status(500)
      .json({ error: "Database operation failed", details: err.message });
  }
});

// 2. POST: สร้างงานใหม่ (Linked to Semester Directly)
router.post("/", authenticateToken, async (req, res) => {
  try {
    const { semesterId, name, description, category, maxScore, weight } =
      req.body;

    if (!semesterId || !name) {
      return res
        .status(400)
        .json({ error: "semesterId and name are required" });
    }

    const newAssignment = await prisma.assignment.create({
      data: {
        semester_id: Number(semesterId),
        name,
        description: description || "",
        category: category || "assignment",
        maxScore: Number(maxScore ?? 100),
        weight: Number(weight ?? 0),
      },
    });

    res.status(201).json(newAssignment);
  } catch (err: any) {
    res.status(500).json({ error: "Failed to create assignment" });
  }
});

// 3. GET: ดึงเกณฑ์น้ำหนักหมวดหมู่ (Fetch by Semester ID)
router.get("/categoriesWeights", authenticateToken, async (req, res) => {
  try {
    const semesterId = Number(req.query.semesterId);
    if (!semesterId)
      return res.status(400).json({ error: "semesterId is required" });

    const categoryWeights = await prisma.assignmentCategoryWeight.findMany({
      where: { semester_id: semesterId },
      orderBy: { category: "asc" },
    });

    res.json(categoryWeights);
  } catch (err: any) {
    res.status(500).json({ error: "Failed to fetch category weights" });
  }
});

// 4. POST: บันทึก/แก้ไขน้ำหนักหมวดหมู่ (Shared by Semester ID)
router.post("/categoriesWeights", authenticateToken, async (req, res) => {
  try {
    const { semesterId, category, maxWeight } = req.body;

    if (!semesterId || !category) {
      return res
        .status(400)
        .json({ error: "semesterId and category are required" });
    }

    const updatedRecord = await prisma.assignmentCategoryWeight.upsert({
      where: {
        semester_id_category: {
          semester_id: Number(semesterId),
          category: category,
        },
      },
      update: { maxWeight: parseFloat(maxWeight) },
      create: {
        semester_id: Number(semesterId),
        category: category,
        maxWeight: parseFloat(maxWeight),
      },
    });

    res.json(updatedRecord);
  } catch (err: any) {
    res.status(500).json({ error: "Failed to update category weight" });
  }
});

// 5. POST: บันทึกน้ำหนักแบบกลุ่ม (Bulk Upsert by Semester ID)
router.post("/categoriesWeights/bulk", authenticateToken, async (req, res) => {
  // 🟢 รับ semesterId มาจาก body ให้ตรงกับโครงสร้าง Hierarchy ใหม่
  const { semesterId, weights } = req.body;

  if (!semesterId || !Array.isArray(weights)) {
    return res
      .status(400)
      .json({ error: "semesterId and weights array are required" });
  }

  try {
    const results = await prisma.$transaction(
      weights.map((w: any) =>
        prisma.assignmentCategoryWeight.upsert({
          where: {
            // 🟢 อ้างอิงตาม @@unique([semester_id, category]) ใน Schema
            semester_id_category: {
              semester_id: Number(semesterId),
              category: w.category,
            },
          },
          update: {
            maxWeight: Number(w.maxWeight) || 0,
          },
          create: {
            semester_id: Number(semesterId),
            category: w.category,
            maxWeight: Number(w.maxWeight) || 0,
          },
        }),
      ),
    );

    res.json({
      success: true,
      message: `Updated ${results.length} category weights for semester ${semesterId}`,
      data: results,
    });
  } catch (err: any) {
    console.error("Bulk Category Weight Error:", err);
    res.status(500).json({
      error: "Bulk update failed",
      details: err.message,
    });
  }
});

// PATCH /assignment/bulk-weights
router.patch("/bulk-weights", authenticateToken, async (req, res) => {
  const { semesterId, updates } = req.body;

  if (!semesterId || !Array.isArray(updates)) {
    return res.status(400).json({ error: "semesterId and updates array are required" });
  }

  try {
    await prisma.$transaction(
      updates.map((item) =>
        prisma.assignment.updateMany({
          where: { 
            id: Number(item.id),
            semester_id: Number(semesterId) // ตรวจสอบความถูกต้องของ Semester
          },
          data: { 
            weight: Number(item.weight) 
          },
        })
      )
    );
    res.json({ success: true, message: "Assignment weights updated" });
  } catch (err) {
    res.status(500).json({ error: "Failed to update assignment weights" });
  }
});

export default router;
