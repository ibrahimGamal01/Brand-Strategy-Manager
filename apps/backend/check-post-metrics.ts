
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkPost() {
  const postId = 'b77384ca-fd07-420f-9e32-48fdf390cd4a';
  console.log(`Checking post ${postId}...`);

  const post = await prisma.socialPost.findUnique({
    where: { id: postId },
  });

  if (!post) {
    console.log('Post not found');
    return;
  }

  console.log('Raw DB Post:', JSON.stringify(post, null, 2));
}

checkPost()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
