export function calc(numBoards: number) {
  const maxThreads = 100;
  const maxPosts = 500;
  const maxFiles = 4;
  const maxFileSize = 5000; // Bytes.
  const maxTotalBytes =
    numBoards * maxThreads * maxPosts * maxFiles * maxFileSize;
  console.log('maxTotalBytes:', maxTotalBytes);
  console.log('Maximum total TB:', maxTotalBytes / 1000 / 1000 / 1000);
}

calc(10);
