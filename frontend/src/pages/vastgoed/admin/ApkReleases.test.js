import { uploadApkChunks } from './ApkReleases';

describe('uploadApkChunks', () => {
  test('uploads all chunks with bounded concurrency and reports progress', async () => {
    const file = { size: 7, slice: (start, end) => ({ start, end }) };
    const uploaded = [];
    const progress = [];
    let active = 0;
    let maxActive = 0;

    await uploadApkChunks(file, 2, async (index, chunk) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 0));
      uploaded.push([index, chunk]);
      active -= 1;
    }, (completed, total) => progress.push([completed, total]));

    expect(maxActive).toBe(3);
    expect(uploaded.sort((a, b) => a[0] - b[0])).toEqual([
      [0, { start: 0, end: 2 }],
      [1, { start: 2, end: 4 }],
      [2, { start: 4, end: 6 }],
      [3, { start: 6, end: 7 }],
    ]);
    expect(progress).toHaveLength(4);
    expect(progress[progress.length - 1]).toEqual([4, 4]);
  });

  test('stops scheduling new chunks and propagates upload errors', async () => {
    const file = { size: 12, slice: (start, end) => ({ start, end }) };
    let releasePendingChunks;
    const pendingChunks = new Promise((resolve) => {
      releasePendingChunks = resolve;
    });
    const sendChunk = jest.fn((index) => {
      if (index === 1) return Promise.reject(new Error('upload failed'));
      return pendingChunks;
    });

    const upload = uploadApkChunks(file, 2, sendChunk);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sendChunk).toHaveBeenCalledTimes(3);
    releasePendingChunks();
    await expect(upload).rejects.toThrow('upload failed');
  });
});
