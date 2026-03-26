import { Router, Request, Response } from "express";
import { authenticateToken } from "../middleware/authMiddleware";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const router = Router();

// 🟢 ปรับ Interface ให้ใช้ semester_id
interface ProgramOnCourseItem {
  program_id: number;
  semester_id: number; // เปลี่ยนจาก course_id
  type: string;
}

// POST: บันทึกความสัมพันธ์หลักสูตรกับรอบการเปิดสอน (Semester)
router.post("/", authenticateToken, async (req: Request, res: Response) => {
  const { updates } = req.body;

  if (!Array.isArray(updates)) {
    return res.status(400).json({ error: "Updates must be an array" });
  }

  try {
    await prisma.$transaction(async (tx) => {
      for (const item of updates as ProgramOnCourseItem[]) {
        // 1. Validation: ตรวจสอบ Program และ Semester ว่ามีอยู่จริง
        const program = await tx.program.findUnique({
          where: { id: Number(item.program_id) },
        });
        const semester = await tx.courseSemester.findUnique({
          where: { id: Number(item.semester_id) },
        });

        if (!program || !semester) {
          throw new Error("PROGRAM_OR_SEMESTER_NOT_FOUND");
        }

        // 2. Upsert: ผูก Program เข้ากับ Semester ID โดยตรง
        await tx.programOnCourse.upsert({
          where: {
            program_id_semester_id: {
              // ใช้ Composite Key ที่เราแก้ใน Prisma Schema
              program_id: Number(item.program_id),
              semester_id: Number(item.semester_id),
            },
          },
          update: {
            type: item.type,
            assignedAt: new Date(),
          },
          create: {
            program_id: Number(item.program_id),
            semester_id: Number(item.semester_id),
            type: item.type,
            assignedAt: new Date(),
          },
        });
      }
    });

    res.json({
      success: true,
      message: "ProgramOnCourse (Semester-based) saved successfully",
    });
  } catch (err: any) {
    console.error("Save ProgramOnCourse Error:", err);
    if (err.message === "PROGRAM_OR_SEMESTER_NOT_FOUND") {
      return res.status(404).json({ error: "Program or Semester not found" });
    }
    res.status(500).json({ error: "Failed to save mappings" });
  }
});

// GET: ดึงข้อมูลความสัมพันธ์
router.get("/", authenticateToken, async (req: Request, res: Response) => {
  try {
    const program_id = req.query.program_id
      ? Number(req.query.program_id)
      : undefined;
    const semester_id = req.query.semester_id
      ? Number(req.query.semester_id)
      : undefined;

    const relations = await prisma.programOnCourse.findMany({
      where: {
        program_id: program_id,
        semester_id: semester_id,
      },
      include: {
        program: true,
        semester: {
          // ดึงข้อมูลวิชาผ่าน Semester
          include: {
            course: true,
          },
        },
      },
    });

    res.json(relations);
  } catch (error) {
    console.error("Fetch ProgramOnCourse Error:", error);
    res.status(500).json({ error: "Failed to fetch mappings" });
  }
});

router.delete("/", authenticateToken, async (req: Request, res: Response) => {
  try {
    const { program_id, semester_id } = req.body;

    if (!program_id || !semester_id) {
      return res
        .status(400)
        .json({ error: "program_id and semester_id are required" });
    }

    await prisma.programOnCourse.delete({
      where: {
        program_id_semester_id: {
          program_id: Number(program_id),
          semester_id: Number(semester_id),
        },
      },
    });

    res.json({ success: true, message: "Mapping deleted successfully" });
  } catch (error) {
    console.error("Delete ProgramOnCourse Error:", error);
    res.status(500).json({ error: "Failed to delete mapping" });
  }
});

export default router;
