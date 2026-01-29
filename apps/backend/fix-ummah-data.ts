import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function fixUmmahData() {
  try {
    const ummahJobId = 'ad6d756e-e7bb-4bfa-84b0-5df6938b474f';
    
    console.log('=== DELETING WRONG DOCUMENT SECTIONS ===\n');
    
    // Delete all document sections for ummahpreneur
    const deleted = await prisma.aiAnalysis.deleteMany({
      where: {
        researchJobId: ummahJobId,
        analysisType: 'DOCUMENT'
      }
    });
    
    console.log(`✅ Deleted ${deleted.count} wrong document sections`);
    console.log(`\nThese sections contained Ghowiba data instead of Ummahpreneur data.`);
    console.log(`The document will now regenerate with the correct ummahpreneur data.\n`);
    
   console.log('Please regenerate the document from the frontend to get correct content.');
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

fixUmmahData();
