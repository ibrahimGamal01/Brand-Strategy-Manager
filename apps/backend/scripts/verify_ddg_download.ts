
import { prisma } from '../src/lib/prisma';
import { ddgDownloaderService } from '../src/services/media/ddg-downloader';

async function main() {
  console.log('Starting DDG Downloader Verification...');

  // 1. Create a dummy Research Job
  const job = await prisma.researchJob.create({
    data: {
      clientId: 'active-client-id', // Ideally we fetch a real one, but for test we might fail if FK constraint.
                                    // Let's find first client
    }
  }).catch(async (e) => {
      // Fallback: finding existing client
      const client = await prisma.client.findFirst();
      if (!client) throw new Error("No clients found to attach job to.");
      
      return await prisma.researchJob.create({
          data: { clientId: client.id }
      });
  });

  console.log('Created/Found Research Job:', job.id);

  // 2. Create a dummy DDG Image Result (valid URL)
  // Using a reliable static image (Google Logo)
  const imageUrl = "https://www.google.com/images/branding/googlelogo/2x/googlelogo_color_92x30dp.png"; 
  
  const img = await prisma.ddgImageResult.create({
    data: {
      researchJobId: job.id,
      query: "test query",
      title: "Test Image",
      imageUrl: imageUrl,
      sourceUrl: "https://via.placeholder.com",
      isDownloaded: false
    }
  });

  console.log('Created DDG Image Result:', img.id);

  // 3. Run Downloader
  await ddgDownloaderService.processPendingDownloads(job.id);

  // 4. Verify
  const updatedImg = await prisma.ddgImageResult.findUnique({
    where: { id: img.id },
    include: { mediaAssets: true }
  });

  if (updatedImg?.isDownloaded && updatedImg.mediaAssets.length > 0) {
    console.log('SUCCESS: Image marked as downloaded and MediaAsset created.');
    console.log('MediaAsset:', updatedImg.mediaAssets[0]);
  } else {
    console.error('FAILURE: Image NOT downloaded properly.');
    console.log('Is Downloaded:', updatedImg?.isDownloaded);
    console.log('Media Assets:', updatedImg?.mediaAssets);
  }
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
