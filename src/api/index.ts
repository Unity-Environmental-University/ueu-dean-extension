/**
 * API layer — stub implementation.
 *
 * All functions here return mock data. When the real API server exists,
 * swap the internals; the types and signatures stay the same.
 *
 * Future: run decohere to generate stubs from type constraints alone.
 */

export interface DeanProfile {
  id: string
  name: string
  email: string
  department: string
}

export interface StudentCase {
  id: string
  studentName: string
  studentId: string
  status: "open" | "pending" | "resolved"
  summary: string
  createdAt: string
}

// --- Stub implementations ---

export async function getCurrentDean(): Promise<DeanProfile> {
  return {
    id: "stub-1",
    name: "Dean Stub",
    email: "dean@unity.edu",
    department: "Academic Affairs",
  }
}

export async function getCasesForStudent(studentId: string): Promise<StudentCase[]> {
  return [
    {
      id: "case-1",
      studentName: "Student Stub",
      studentId,
      status: "open",
      summary: "Stub case for development",
      createdAt: new Date().toISOString(),
    },
  ]
}
