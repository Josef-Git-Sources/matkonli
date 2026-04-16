import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';

/**
 * Resizes an image to a max width of 1080px and compresses it to quality 0.7.
 * Returns the URI of the compressed image.
 */
export async function compressImage(uri: string): Promise<string> {
  const result = await manipulateAsync(
    uri,
    [{ resize: { width: 1080 } }],
    { compress: 0.7, format: SaveFormat.JPEG },
  );
  return result.uri;
}
