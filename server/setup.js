import mongoose from 'mongoose';
import { connectDB } from './config/db.js';
import Enquiry from './models/Enquiry.js';
try {
  await connectDB();
  await Enquiry.createIndexes();
  console.log('Enquiry indexes ready.');
} catch {
  console.error('Database setup failed. Check Atlas connectivity and database permissions.');
  process.exitCode = 1;
} finally { await mongoose.disconnect(); }
