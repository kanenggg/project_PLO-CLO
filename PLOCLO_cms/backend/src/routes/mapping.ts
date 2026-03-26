import { Router, Request, Response } from "express";
import { authenticateToken } from "../middleware/authMiddleware";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const router = Router();

/**
 * 1. CLO to PLO Mapping (รองรับการดึงข้อมูลหลายหลักสูตรพร้อมกัน)
 */
router.get(
  "/clo-plo/:courseId",
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const courseId = parseInt(req.params.courseId as string);
      const { semesterId, programId } = req.query; // รับ "8,7"

      if (isNaN(courseId)) {
        return res
          .status(400)
          .json({ error: "Course ID are required" });
      }

      // 🟢 แปลง "8,7" เป็น [8, 7]
      const idArray = String(programId)
        .split(",")
        .map((id) => parseInt(id.trim()))
        .filter((id) => !isNaN(id));

      const mappings = await prisma.cloPloMapping.findMany({
        where: {
          semester_id: Number(semesterId),
          program_id: { in: idArray }, // 🟢 ดึง Mapping ของทุกหลักสูตรในคราวเดียว
          clos: { course_id: courseId },
        },
        select: {
          cloId: true,
          ploId: true,
          program_id: true, // เพิ่มเพื่อให้ Frontend แยกได้ว่าอันไหนของใคร
          weight: true,
        },
      });

      res.json(
        mappings.map((m) => ({
          clo_id: m.cloId,
          plo_id: m.ploId,
          program_id: m.program_id,
          weight: Number(m.weight),
        })),
      );
    } catch (err) {
      console.error("Fetch CLO-PLO Error:", err);
      res.status(500).json({ error: "Failed to fetch mappings" });
    }
  },
);

router.post(
  "/clo-plo",
  authenticateToken,
  async (req: Request, res: Response) => {
    const { updates } = req.body;
    try {
      await prisma.$transaction(
        updates.map((item: any) => {
          const { clo_id, plo_id, program_id, semester_id, weight } = item;
          const whereClause = {
            cloId_ploId_program_id_semester_id: {
              // ⚠️ ชื่อนี้ต้องตรงตามที่ Prisma generate
              cloId: Number(clo_id),
              ploId: Number(plo_id),
              program_id: Number(program_id),
              semester_id: Number(semester_id),
            },
          };

          if (weight > 0) {
            return prisma.cloPloMapping.upsert({
              where: whereClause,
              update: { weight, updatedAt: new Date() },
              create: {
                cloId: Number(clo_id),
                ploId: Number(plo_id),
                program_id: Number(program_id),
                semester_id: Number(semester_id),
                weight,
              },
            });
          } else {
            return prisma.cloPloMapping.deleteMany({ where: item });
          }
        }),
      );
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: "Save failed" });
    }
  },
);

/**
 * 2. Assignment to CLO Mapping
 */
router.post(
  "/assignment-clo",
  authenticateToken,
  async (req: Request, res: Response) => {
    const { updates } = req.body;
    if (!Array.isArray(updates))
      return res.status(400).json({ error: "Invalid data" });

    try {
      await prisma.$transaction(
        updates.map((item) => {
          const weight = Number(item.weight ?? 0);
          const assId = Number(item.assignment_id);
          const cloId = Number(item.clo_id);

          if (weight > 0 && weight <= 100) {
            return prisma.assignmentCloMapping.upsert({
              where: { assId_cloId: { assId, cloId } },
              update: { weight, updatedAt: new Date() },
              create: { assId, cloId, weight },
            });
          } else {
            return prisma.assignmentCloMapping.deleteMany({
              where: { assId, cloId },
            });
          }
        }),
      );

      res.json({ success: true, message: "Assignment-CLO Mapping saved" });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to save Assignment-CLO" });
    }
  },
);

router.get(
  "/assignment-clo/:semesterId",
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const semesterId = parseInt(req.params.semesterId as string);
      if (isNaN(semesterId))
        return res.status(400).json({ error: "Invalid Semester ID" });

      const mappings = await prisma.assignmentCloMapping.findMany({
        where: { assignment: { semester_id: semesterId } },
        select: { assId: true, cloId: true, weight: true },
      });

      res.json(mappings.map((m) => ({ ...m, weight: Number(m.weight) })));
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch Assignment-CLO" });
    }
  },
);

export default router;
