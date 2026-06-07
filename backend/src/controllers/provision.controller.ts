import { randomInt } from 'node:crypto';
import type { Request, Response } from 'express';
import mongoose, { Types } from 'mongoose';
import bcrypt from 'bcrypt';
import { ApiError } from '../utils/api-error.js';
import { sendResponse } from '../utils/response.js';
import { generateSchoolId } from '../utils/idGenerator.js';
import { User } from '../models/User.js';
import { Parent } from '../models/Parent.js';
import { Student } from '../models/Student.js';
import Teacher from '../models/Teacher.js';
import { Class } from '../models/Class.js';
import { Section } from '../models/Section.js';
import {
  sendExistingParentNewChildEmail,
  sendWelcomeParentEmail,
  sendWelcomeStudentEmail,
  sendWelcomeTeacherEmail,
} from '../services/email.service.js';

const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const DEFAULT_STUDENT_DOB = new Date('2010-01-01T00:00:00.000Z');
const DEFAULT_STUDENT_GENDER: 'MALE' | 'FEMALE' | 'OTHER' = 'OTHER';

function splitFullName(fullName: string): { firstName: string; lastName: string } {
  const cleaned = fullName.trim().replace(/\s+/g, ' ');
  const parts = cleaned.length > 0 ? cleaned.split(' ') : [];
  const firstName = parts[0] || 'User';
  const lastName = parts.slice(1).join(' ') || 'User';

  return { firstName, lastName };
}

function generateTemporaryPassword(length = 8): string {
  let password = '';

  for (let index = 0; index < length; index += 1) {
    password += PASSWORD_ALPHABET[randomInt(0, PASSWORD_ALPHABET.length)];
  }

  return password;
}

function toObjectId(value: string, fieldName: string): Types.ObjectId {
  if (!Types.ObjectId.isValid(value)) {
    throw new ApiError(400, `Invalid ${fieldName}`);
  }

  return new Types.ObjectId(value);
}

async function resolveClassSection(
  schoolId: Types.ObjectId,
  classId: string,
  session: mongoose.ClientSession,
): Promise<{ classDoc: mongoose.HydratedDocument<any>; sectionDoc: mongoose.HydratedDocument<any> }> {
  const classObjectId = toObjectId(classId, 'classId');
  const classDoc = await Class.findOne({ _id: classObjectId, schoolId }).session(session);

  if (!classDoc) {
    throw new ApiError(404, 'Class not found for the current school');
  }

  let sectionDoc = await Section.findOne({ schoolId, classId: classDoc._id }).sort({ createdAt: 1 }).session(session);

  if (!sectionDoc) {
    sectionDoc = await new Section({
      schoolId,
      classId: classDoc._id,
      name: 'A',
    }).save({ session });
  }

  return { classDoc, sectionDoc };
}

async function settleCredentialEmails(tasks: Promise<unknown>[]): Promise<{ attempted: number; failed: number; warnings: string[] }> {
  const results = await Promise.allSettled(tasks);
  const warnings: string[] = [];

  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      const reason = result.reason instanceof Error ? result.reason.message : 'Unknown email dispatch failure';
      warnings.push(`Email task ${index + 1} failed: ${reason}`);
      console.error(`[provision.controller] email task ${index + 1} failed`, result.reason);
    }
  });

  return {
    attempted: results.length,
    failed: warnings.length,
    warnings,
  };
}

export const provisionTeacher = async (req: Request, res: Response): Promise<Response> => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const { teacherName, teacherEmail } = req.body as { teacherName?: string; teacherEmail?: string };
    if (!teacherName || !teacherEmail) {
      throw new ApiError(400, 'teacherName and teacherEmail are required');
    }

    const schoolId = req.user?.schoolId;
    if (!schoolId) {
      throw new ApiError(400, 'Authenticated school context is required');
    }

    const schoolObjectId = toObjectId(schoolId, 'schoolId');
    const actorId = req.user?.id ? toObjectId(req.user.id, 'authenticated user id') : undefined;
    const normalizedEmail = teacherEmail.trim().toLowerCase();
    const { firstName, lastName } = splitFullName(teacherName);

    const existingTeacher = await User.findOne({ schoolId: schoolObjectId, email: normalizedEmail }).session(session);
    if (existingTeacher) {
      throw new ApiError(409, 'A teacher account with this email already exists in this school');
    }

    const customId = await generateSchoolId('teacher');
    const tempPassword = generateTemporaryPassword(8);
    const passwordHash = await bcrypt.hash(tempPassword, 12);

    const user = await new User({
      schoolId: schoolObjectId,
      email: normalizedEmail,
      passwordHash,
      firstName,
      lastName,
      role: 'TEACHER',
      customId,
      mustChangePassword: true,
      isActive: true,
      createdBy: actorId,
      updatedBy: actorId,
    }).save({ session });

    await new Teacher({
      userId: user._id,
      name: teacherName.trim(),
    }).save({ session });

    await session.commitTransaction();

    const emailJobs = [
      sendWelcomeTeacherEmail(normalizedEmail, teacherName.trim(), customId, tempPassword),
    ];
    const emailSummary = await settleCredentialEmails(emailJobs);

    return sendResponse(
      res,
      201,
      'Teacher provisioned successfully',
      {
        teacher: {
          name: teacherName.trim(),
          email: normalizedEmail,
          customId,
          tempPassword,
          mustChangePassword: true,
        },
      },
      {
        emailDelivery: emailSummary,
      },
    );
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }

    const statusCode = error instanceof ApiError ? error.statusCode : 500;
    const message = error instanceof Error ? error.message : 'Internal server error';

    return sendResponse(res, statusCode, message);
  } finally {
    session.endSession();
  }
};

export const adminCreateStudentAndParent = async (req: Request, res: Response): Promise<Response> => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const {
      studentName,
      studentEmail,
      classId,
      parentName,
      parentEmail,
      parentPhone,
    } = req.body as {
      studentName?: string;
      studentEmail?: string;
      classId?: string;
      parentName?: string;
      parentEmail?: string;
      parentPhone?: string;
    };

    if (!studentName || !studentEmail || !classId || !parentName || !parentEmail) {
      throw new ApiError(400, 'studentName, studentEmail, classId, parentName, and parentEmail are required');
    }

    const schoolId = req.user?.schoolId;
    if (!schoolId) {
      throw new ApiError(400, 'Authenticated school context is required');
    }

    const schoolObjectId = toObjectId(schoolId, 'schoolId');
    const actorId = req.user?.id ? toObjectId(req.user.id, 'authenticated user id') : undefined;
    const normalizedStudentEmail = studentEmail.trim().toLowerCase();
    const normalizedParentEmail = parentEmail.trim().toLowerCase();
    const cleanStudentName = studentName.trim();
    const cleanParentName = parentName.trim();
    const { firstName: studentFirstName, lastName: studentLastName } = splitFullName(cleanStudentName);
    const { firstName: parentFirstName, lastName: parentLastName } = splitFullName(cleanParentName);

    const existingStudentUser = await User.findOne({
      schoolId: schoolObjectId,
      email: normalizedStudentEmail,
    }).session(session);
    if (existingStudentUser) {
      throw new ApiError(409, 'A student account with this email already exists in this school');
    }

    let parentUser = await User.findOne({
      schoolId: schoolObjectId,
      email: normalizedParentEmail,
    }).session(session);
    let parentProfile: mongoose.HydratedDocument<any> | null = parentUser
      ? await Parent.findOne({ schoolId: schoolObjectId, userId: parentUser._id }).session(session)
      : null;
    let parentTempPassword: string | null = null;
    let isNewParent = false;

    if (parentUser && parentUser.role !== 'PARENT') {
      throw new ApiError(409, 'The supplied parent email is already used by a non-parent account');
    }

    if (!parentUser) {
      isNewParent = true;
      parentTempPassword = generateTemporaryPassword(8);
      const parentCustomId = await generateSchoolId('parent');
      const parentPasswordHash = await bcrypt.hash(parentTempPassword, 12);

      parentUser = await new User({
        schoolId: schoolObjectId,
        email: normalizedParentEmail,
        passwordHash: parentPasswordHash,
        firstName: parentFirstName,
        lastName: parentLastName,
        role: 'PARENT',
        customId: parentCustomId,
        mustChangePassword: true,
        isActive: true,
        createdBy: actorId,
        updatedBy: actorId,
      }).save({ session });
    }

    if (!parentUser) {
      throw new ApiError(500, 'Failed to create or resolve parent credentials');
    }

    if (!parentProfile) {
      if (!parentPhone) {
        throw new ApiError(400, 'parentPhone is required when provisioning a new parent profile');
      }

      parentProfile = await new Parent({
        schoolId: schoolObjectId,
        userId: parentUser._id,
        contactPrimary: parentPhone.trim(),
        childrenIds: [],
        createdBy: actorId,
        updatedBy: actorId,
      }).save({ session });
    } else if (parentPhone && !parentProfile.contactPrimary) {
      parentProfile.contactPrimary = parentPhone.trim();
      if (actorId) {
        parentProfile.updatedBy = actorId;
      }
      await parentProfile.save({ session });
    }

    if (!parentProfile) {
      throw new ApiError(500, 'Failed to create or resolve parent profile');
    }

    if (!parentProfile.contactPrimary && !parentPhone) {
      throw new ApiError(400, 'Unable to provision parent profile without a primary contact number');
    }

    const studentCustomId = await generateSchoolId('student');
    const studentTempPassword = generateTemporaryPassword(8);
    const studentPasswordHash = await bcrypt.hash(studentTempPassword, 12);
    const { sectionDoc } = await resolveClassSection(schoolObjectId, classId, session);

    const studentUser = await new User({
      schoolId: schoolObjectId,
      email: normalizedStudentEmail,
      passwordHash: studentPasswordHash,
      firstName: studentFirstName,
      lastName: studentLastName,
      role: 'STUDENT',
      customId: studentCustomId,
      mustChangePassword: true,
      isActive: true,
      createdBy: actorId,
      updatedBy: actorId,
    }).save({ session });

    if (!studentUser) {
      throw new ApiError(500, 'Failed to create student credentials');
    }

    const studentProfile = await new Student({
      schoolId: schoolObjectId,
      userId: studentUser._id,
      admissionNumber: studentCustomId,
      rollNumber: studentCustomId,
      classId: sectionDoc.classId,
      sectionId: sectionDoc._id,
      parentIds: [parentProfile._id],
      dob: DEFAULT_STUDENT_DOB,
      gender: DEFAULT_STUDENT_GENDER,
      isActive: true,
      isDeleted: false,
      createdBy: actorId,
      updatedBy: actorId,
    }).save({ session });

    if (!studentProfile) {
      throw new ApiError(500, 'Failed to create student profile');
    }

    const parentUpdate: Record<string, unknown> = {
      $addToSet: { childrenIds: studentProfile._id },
    };
    if (actorId) {
      parentUpdate.$set = { updatedBy: actorId };
    }

    await Parent.updateOne({ _id: parentProfile._id }, parentUpdate, { session });

    await session.commitTransaction();

    const emailJobs: Promise<unknown>[] = [
      sendWelcomeStudentEmail(normalizedStudentEmail, cleanStudentName, studentCustomId, studentTempPassword),
    ];

    if (isNewParent && parentTempPassword) {
      emailJobs.push(sendWelcomeParentEmail(normalizedParentEmail, cleanParentName, parentUser.customId ?? 'PARENT', parentTempPassword));
    } else {
      emailJobs.push(sendExistingParentNewChildEmail(normalizedParentEmail, cleanParentName, cleanStudentName, studentCustomId));
    }

    const emailSummary = await settleCredentialEmails(emailJobs);

    const receipt = {
      student: {
        name: cleanStudentName,
        email: normalizedStudentEmail,
        customId: studentCustomId,
        tempPassword: studentTempPassword,
        classId: sectionDoc.classId.toString(),
        sectionId: sectionDoc._id.toString(),
      },
      parent: {
        name: cleanParentName,
        email: normalizedParentEmail,
        customId: parentUser.customId ?? null,
        isNewAccount: isNewParent,
        tempPassword: parentTempPassword,
        childLinked: studentCustomId,
      },
    };

    return sendResponse(
      res,
      201,
      'Student and parent provisioned successfully',
      receipt,
      {
        emailDelivery: emailSummary,
      },
    );
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }

    const statusCode = error instanceof ApiError ? error.statusCode : 500;
    const message = error instanceof Error ? error.message : 'Internal server error';

    return sendResponse(res, statusCode, message);
  } finally {
    session.endSession();
  }
};

export const provisionStudentAndParent = adminCreateStudentAndParent;
