import { Router, Request, Response } from "express";
import { authenticateToken } from "../middleware/authMiddleware";
import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();
const router = Router();

// Helper สำหรับแปลงเลข
const parseIntSafe = (value: any) => {
  if (!value) return undefined;
  const parsed = parseInt(String(value));
  return isNaN(parsed) ? undefined : parsed;
};

// =========================================
// 1. GET /paginate (สำหรับแสดงผลตาราง)
// =========================================
router.get(
  "/paginate",
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const universityId = parseIntSafe(req.query.universityId);
      const facultyId = parseIntSafe(req.query.facultyId);
      const programId = parseIntSafe(req.query.programId);
      const year = parseIntSafe(req.query.year);
      const semester = parseIntSafe(req.query.semester);
      const section = parseIntSafe(req.query.section);
      const courseId = parseIntSafe(req.query.courseId);

      const page = parseIntSafe(req.query.page) || 1;
      const limit = parseIntSafe(req.query.limit) || 10;
      const skip = (page - 1) * limit;

      const where: any = {
        course: {
          id: courseId || undefined,
          faculty_id: facultyId || undefined,
          faculty: universityId ? { university_id: universityId } : undefined,
          semesters:
            year || semester || programId
              ? {
                  some: {
                    year: year || undefined,
                    semester: semester || undefined,
                    programOnCourses: programId
                      ? { some: { program_id: programId } }
                      : undefined,
                    sections: section
                      ? { some: { section: section } }
                      : undefined,
                  },
                }
              : undefined,
        },
      };

      const [total, clos] = await prisma.$transaction([
        prisma.clo.count({ where }),
        prisma.clo.findMany({
          where,
          include: {
            course: {
              include: {
                semesters: {
                  where: year ? { year } : {},
                  include: {
                    programOnCourses: { include: { program: true } },
                  },
                },
              },
            },
          },
          skip,
          take: limit,
          orderBy: { id: "asc" },
        }),
      ]);

      const formattedData = clos.map((c) => ({
        id: c.id,
        code: c.code,
        name: c.name,
        name_th: c.name_th,
        course_id: c.course.id,
        course_code: c.course.code,
        programs: Array.from(
          new Set(
            c.course.semesters.flatMap((s) =>
              s.programOnCourses.map((p) => p.program.program_code),
            ),
          ),
        ),
      }));

      res.json({
        data: formattedData,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      });
    } catch (err) {
      console.error("Pagination Error:", err);
      res.status(500).json({ error: "Failed to fetch paginated CLOs" });
    }
  },
);

// =========================================
// 2. GET / (Simple List)
// =========================================
router.get("/", authenticateToken, async (req: Request, res: Response) => {
  const courseId = parseIntSafe(req.query.courseId);
  try {
    const clos = await prisma.clo.findMany({
      where: { course_id: courseId || undefined },
      orderBy: { id: "asc" },
    });
    res.json(clos);
  } catch (err) {
    res.status(500).json({ error: "Unable to retrieve CLO information" });
  }
});

// =========================================
// 3. POST / (Add Single CLO)
// =========================================
router.post("/", authenticateToken, async (req: Request, res: Response) => {
  const { code, name, name_th, course_id } = req.body;

  try {
    const newClo = await prisma.clo.create({
      data: {
        code,
        name,
        name_th: name_th || name,
        course_id: Number(course_id),
      },
    });
    res.status(201).json(newClo);
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return res
        .status(409)
        .json({ error: "This CLO code already exists in this course" });
    }
    res.status(500).json({ error: "Unable to add CLO" });
  }
});

// =========================================
// 4. POST /bulk (Upload Many)
// =========================================
router.post("/bulk", authenticateToken, async (req: Request, res: Response) => {
  const { clos } = req.body;

  if (!Array.isArray(clos) || clos.length === 0) {
    return res.status(400).json({ error: "No CLOs provided" });
  }

  try {
    // กรองข้อมูลให้เป็น Number ก่อนส่งเข้า createMany
    const data = clos.map((clo) => ({
      code: clo.code,
      name: clo.name,
      name_th: clo.name_th || clo.name,
      course_id: Number(clo.course_id),
    }));

    const result = await prisma.clo.createMany({
      data,
      skipDuplicates: true, // ข้ามถ้ามีรหัสซ้ำในคอร์สเดียวกัน
    });

    res
      .status(201)
      .json({ message: "Bulk upload successful", count: result.count });
  } catch (err) {
    res.status(500).json({ error: "Bulk upload failed" });
  }
});

// =========================================
// 5. PATCH /:id (Update)
// =========================================
router.patch("/:id", authenticateToken, async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string);
  const { code, name, name_th } = req.body;

  try {
    const updated = await prisma.clo.update({
      where: { id },
      data: { code, name, name_th },
    });
    res.json(updated);
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return res
        .status(409)
        .json({ error: "This CLO code already exists in this course" });
    }
    res.status(404).json({ error: "CLO not found" });
  }
});

// =========================================
// 6. DELETE /bulk-delete
// =========================================
router.delete(
  "/bulk-delete",
  authenticateToken,
  async (req: Request, res: Response) => {
    const { cloIds } = req.body;

    if (!Array.isArray(cloIds))
      return res.status(400).json({ error: "Invalid IDs" });

    try {
      const deleted = await prisma.clo.deleteMany({
        where: { id: { in: cloIds.map((id) => Number(id)) } },
      });
      res.json({ message: "Bulk delete successful", count: deleted.count });
    } catch (err) {
      res.status(500).json({ error: "Bulk delete failed" });
    }
  },
);

// =========================================
// 7. DELETE /:id
// =========================================
router.delete(
  "/:id",
  authenticateToken,
  async (req: Request, res: Response) => {
    const id = parseInt(req.params.id as string);
    try {
      await prisma.clo.delete({ where: { id } });
      res.status(204).send();
    } catch (err) {
      res.status(404).json({ error: "CLO not found" });
    }
  },
);

export default router;
