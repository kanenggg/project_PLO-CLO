import { Router, Request, Response } from "express";
import { pool } from "../db";
import { authenticateToken } from "../middleware/authMiddleware";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const router = Router();

/**
 * ✅ GET students (Supports single or multiple programIds via comma)
 * Example: /student?programId=8 OR /student?programId=8,7
 */
router.get("/", authenticateToken, async (req: Request, res: Response) => {
  try {
    const { programId } = req.query;

    if (!programId) {
      return res.status(400).json({ error: "Program ID is required" });
    }

    // แปลง "8,7" เป็น [8, 7]
    const idArray = String(programId)
      .split(",")
      .map((id) => parseInt(id.trim()))
      .filter((id) => !isNaN(id));

    if (idArray.length === 0) {
      return res.status(400).json({ error: "Invalid Program ID format" });
    }

    const result = await pool.query(
      `SELECT 
        student.id,
        student.student_code,
        student.first_name,
        student.last_name,
        student.email,
        student.program_id,
        p.program_shortname_en,
        p.program_shortname_th,
        p.program_name_en,
        p.program_name_th
      FROM student 
      JOIN program p ON student.program_id = p.id
      WHERE student.program_id = ANY($1::int[])
      ORDER BY student.id DESC`,
      [idArray],
    );

    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching students:", err);
    res.status(500).json({ error: "Failed to fetch students" });
  }
});

/**
 * ✅ POST create new student
 */
router.post("/", authenticateToken, async (req: Request, res: Response) => {
  const { student_code, first_name, last_name, email, program_id } = req.body;

  if (!student_code || !first_name || !last_name || !program_id) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    const result = await pool.query(
      `INSERT INTO student (student_code, first_name, last_name, program_id, email)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [student_code, first_name, last_name, Number(program_id), email],
    );
    res.status(201).json(result.rows[0]);
  } catch (err: any) {
    if (err.code === "23505")
      return res
        .status(400)
        .json({ error: "Student ID or email already exists" });
    res.status(500).json({ error: "Failed to create student" });
  }
});

/**
 * ✅ POST bulk create students (Using Transaction)
 */
router.post("/bulk", authenticateToken, async (req: Request, res: Response) => {
  const { students } = req.body;
  if (!Array.isArray(students) || students.length === 0) {
    return res.status(400).json({ error: "Students array is required" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const insertedStudents = [];
    for (const student of students) {
      const res = await client.query(
        `INSERT INTO student (student_code, first_name, last_name, program_id, email)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [
          student.student_code,
          student.first_name,
          student.last_name,
          student.program_id,
          student.email,
        ],
      );
      insertedStudents.push(res.rows[0]);
    }
    await client.query("COMMIT");
    res.status(201).json({ insertedStudents });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: "Bulk insert failed" });
  } finally {
    client.release();
  }
});

/**
 * ✅ DELETE bulk students
 */
router.delete(
  "/bulk-delete",
  authenticateToken,
  async (req: Request, res: Response) => {
    const { studentIds } = req.body;
    if (!Array.isArray(studentIds) || studentIds.length === 0) {
      return res.status(400).json({ error: "studentIds array is required" });
    }

    try {
      const result = await pool.query(
        `DELETE FROM student WHERE id = ANY($1::int[]) RETURNING *`,
        [studentIds],
      );
      res.json({
        message: `${result.rowCount} students deleted`,
        deletedStudents: result.rows,
      });
    } catch (err) {
      res.status(500).json({ error: "Bulk delete failed" });
    }
  },
);

/**
 * ✅ GET paginated students
 */
router.get(
  "/paginate",
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const universityId = req.query.universityId as string;
      const facultyId = req.query.facultyId as string;
      const programId = req.query.programId as string;
      const year = req.query.year as string;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const offset = (page - 1) * limit;

      let whereClause = "WHERE 1=1";
      const params: any[] = [];

      const addFilter = (val: any, field: string) => {
        if (val) {
          params.push(val);
          whereClause += ` AND ${field} = $${params.length}`;
        }
      };

      addFilter(universityId, "university.id");
      addFilter(facultyId, "faculty.id");
      addFilter(programId, "program.id"); // กรองด้วย ID ของ Program จะแม่นยำกว่า
      addFilter(year, "program.program_year");

      const dataQuery = `
      SELECT student.*, program.program_shortname_th, program.program_shortname_en, program.program_year
      FROM student
      JOIN program ON student.program_id = program.id
      JOIN faculty ON program.faculty_id = faculty.id
      JOIN university ON faculty.university_id = university.id
      ${whereClause}
      ORDER BY student.id ASC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;

      const countQuery = `
      SELECT COUNT(*) FROM student
      JOIN program ON student.program_id = program.id
      JOIN faculty ON program.faculty_id = faculty.id
      JOIN university ON faculty.university_id = university.id
      ${whereClause}`;

      const [dataRes, countRes] = await Promise.all([
        pool.query(dataQuery, [...params, limit, offset]),
        pool.query(countQuery, params),
      ]);

      res.json({
        data: dataRes.rows,
        total: parseInt(countRes.rows[0].count),
        page,
        limit,
      });
    } catch (err) {
      res.status(500).json({ error: "Pagination failed" });
    }
  },
);

/**
 * ✅ Standard CRUD (Single)
 */
router.get("/:id", authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT student.*, p.program_shortname_en, p.program_shortname_th 
       FROM student JOIN program p ON student.program_id = p.id WHERE student.id = $1`,
      [req.params.id],
    );
    if (result.rows.length === 0)
      return res.status(404).json({ error: "Student not found" });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: "Fetch failed" });
  }
});

router.patch("/:id", authenticateToken, async (req, res) => {
  const { first_name, last_name, student_code, email } = req.body;
  try {
    const result = await pool.query(
      `UPDATE student SET first_name = $1, last_name = $2, student_code = $3, email = $4 
       WHERE id = $5 RETURNING *`,
      [first_name, last_name, student_code, email, req.params.id],
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: "Update failed" });
  }
});

router.delete("/:id", authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      "DELETE FROM student WHERE id = $1 RETURNING *",
      [req.params.id],
    );
    if (result.rows.length === 0)
      return res.status(404).json({ error: "Student not found" });
    res.json({ message: "Deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: "Delete failed" });
  }
});

export default router;
