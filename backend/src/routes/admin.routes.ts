import { Router } from 'express';
import { provisionTeacher, provisionStudentAndParent } from '../controllers/provision.controller.js';
import { authenticateToken, requireRoles } from '../middleware/auth.js';

const router = Router();

type RouteRole = 'admin';

const authorize = (_roles: RouteRole[]) => {
  return requireRoles('SUPER_ADMIN', 'SCHOOL_ADMIN');
};

// Endpoint for creating teachers
router.post('/create-teacher', authenticateToken, authorize(['admin']), provisionTeacher);

// Transactional endpoint for creating students alongside their parent profile
router.post('/create-student-parent', authenticateToken, authorize(['admin']), provisionStudentAndParent);

export default router;
