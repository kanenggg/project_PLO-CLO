import { Router, Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { authenticateToken } from "../middleware/authMiddleware";

const prisma = new PrismaClient();
const router = Router();

/**
 * ✅ GET PLOs (รองรับทั้ง ID เดียวและหลาย ID)
 * Example: /plo?programId=8,7
 */
router.get("/", authenticateToken, async (req: Request, res: Response) => {
  try {
    const { programId } = req.query;

    if (!programId) {
      return res.status(400).json({ error: "Program ID is required" });
    }

    // 1. แปลง String "8,7" -> [8, 7]
    const idArray = String(programId)
      .split(",")
      .map((id) => parseInt(id.trim()))
      .filter((id) => !isNaN(id));

    if (idArray.length === 0) {
      return res.status(400).json({ error: "Invalid Program ID format" });
    }

    // 2. ใช้ Prisma Query พร้อมดึง Relation ของ Program
    const plos = await prisma.plo.findMany({
      where: {
        program_id: {
          in: idArray, // 🟢 ใช้ 'in' เพื่อรองรับ Array ของ IDs
        },
      },
      include: {
        program: true, // ดึงข้อมูลหลักสูตรที่เชื่อมอยู่มาด้วยอัตโนมัติ
      },
      orderBy: [
        { program_id: "asc" },
        { code: "asc" }, // เรียงตามรหัส PLO
      ],
    });

    res.json(plos);
  } catch (err) {
    console.error("Prisma Fetch PLO Error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

/**
 * ✅ POST create new PLO
 */
router.post("/", authenticateToken, async (req: Request, res: Response) => {
  const { code, program_id, name, engname } = req.body;

  try {
    const newPlo = await prisma.plo.create({
      data: {
        code,
        program_id: Number(program_id),
        name,
        engname,
      },
    });
    res.status(201).json(newPlo);
  } catch (err: any) {
    // จัดการกรณีข้อมูลซ้ำ (Unique Constraint)
    if (err.code === "P2002") {
      return res
        .status(409)
        .json({ error: "PLO code already exists in this program" });
    }
    res.status(500).json({ error: "Failed to create PLO" });
  }
});

/**
 * ✅ DELETE bulk PLOs
 */
router.delete(
  "/bulk-delete",
  authenticateToken,
  async (req: Request, res: Response) => {
    const { ploIds } = req.body; // รับ [101, 102]

    if (!Array.isArray(ploIds))
      return res.status(400).json({ error: "IDs required" });

    try {
      const result = await prisma.plo.deleteMany({
        where: {
          id: { in: ploIds },
        },
      });
      res.json({ message: `Deleted ${result.count} PLOs successfully` });
    } catch (err) {
      res.status(500).json({ error: "Bulk delete failed" });
    }
  },
);

/**
 * ✅ GET paginated PLOs
 */
router.get(
  "/paginate",
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const { universityId, facultyId, programId, year } = req.query;
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = Math.max(1, parseInt(req.query.limit as string) || 10);
      const skip = (page - 1) * limit;

      const where: any = {};
      if (universityId)
        where.program = { faculty: { university_id: Number(universityId) } };
      if (facultyId) where.program = { faculty_id: Number(facultyId) };
      if (programId) where.program_id = Number(programId);
      if (year)
        where.program = { ...where.program, program_year: String(year) };

      // 🟢 ดึงข้อมูล
      const [data, total] = await Promise.all([
        prisma.plo.findMany({
          where,
          include: { program: true },
          skip: skip,
          take: limit,
          orderBy: [
            {
              id: "asc", // อันนี้คือค่าเริ่มต้น
            },
          ],
        }),
        prisma.plo.count({ where }),
      ]);

      res.json({
        data: data,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      });
    } catch (err) {
      console.error("Pagination Error:", err);
      res.status(500).json({ error: "Pagination failed" });
    }
  },
);

router.post("/bulk", authenticateToken, async (req: Request, res: Response) => {
  const { plos } = req.body;

  if (!Array.isArray(plos)) {
    return res.status(400).json({ error: "Invalid data format" });
  }

  try {
    const newPlos = await prisma.plo.createMany({
      data: plos.map((plo) => ({
        code: plo.code,
        program_id: Number(plo.program_id),
        name: plo.name,
        engname: plo.engname,
      })),
    });
    res.status(201).json(newPlos);
  } catch (err: any) {
    if (err.code === "P2002") {
      return res
        .status(409)
        .json({ error: "One or more PLO codes already exist in their respective programs" });
    }
    res.status(500).json({ error: "Failed to create PLOs" });
  }
});


export default router;
