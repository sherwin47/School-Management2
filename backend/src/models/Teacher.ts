import mongoose, { Schema, Document, Types } from 'mongoose';

export interface ITeacher extends Document {
  userId: Types.ObjectId;
  name: string;
}

const TeacherSchema: Schema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  name: { type: String, required: true }
}, {
  timestamps: true
});

export default mongoose.model<ITeacher>('Teacher', TeacherSchema);
