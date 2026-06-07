import mongoose from 'mongoose';
import Counter from '../models/Counter.js';

export const generateSchoolId = async (role: string): Promise<string> => {
  const currentYear = new Date().getFullYear();
  let prefix = '';

  switch (role) {
    case 'teacher':
      prefix = 'TCH';
      break;
    case 'student':
      prefix = 'STU';
      break;
    case 'parent':
      prefix = 'PAR';
      break;
    case 'admin':
      prefix = 'ADM';
      break;
    default:
      prefix = 'USR';
  }

  // Uses a global counter based on the system year and role type
  const counterId = `global_${role}_${currentYear}`;

  const counter = await Counter.findByIdAndUpdate(
    counterId,
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );

  const sequenceNumber = counter.seq.toString().padStart(4, '0');
  
  return `${prefix}-${currentYear}-${sequenceNumber}`;
};
