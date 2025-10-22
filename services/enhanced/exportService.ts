/**
 * Enhanced Export Service
 * Multi-format export with templates, styling, and advanced formatting options
 */

import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { EnhancedTranscriptionItem, ExportFormat, ExportOptions, ExportTemplate } from '../../types';

interface ExportResult {
  success: boolean;
  filePath?: string;
  error?: string;
  format: ExportFormat;
  size: number;
}

class ExportService {
  private readonly exportDir = `${FileSystem.documentDirectory}exports/`;

  /**
   * Export transcription in specified format
   */
  async exportTranscription(
    item: EnhancedTranscriptionItem,
    options: ExportOptions
  ): Promise<ExportResult> {
    try {
      // Ensure export directory exists
      await this.ensureExportDirectory();

      // Generate filename
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `transcription-${item.id}-${timestamp}.${options.format}`;
      const filePath = `${this.exportDir}${filename}`;

      // Generate content based on format
      let content: string;
      let size: number;

      switch (options.format) {
        case 'txt':
          content = this.generateTextExport(item, options);
          break;
        case 'json':
          content = this.generateJsonExport(item, options);
          break;
        case 'srt':
          content = this.generateSrtExport(item, options);
          break;
        case 'vtt':
          content = this.generateVttExport(item, options);
          break;
        case 'docx':
          content = this.generateDocxExport(item, options);
          break;
        case 'pdf':
          content = this.generatePdfExport(item, options);
          break;
        default:
          throw new Error(`Unsupported export format: ${options.format}`);
      }

      // Write file
      await FileSystem.writeAsStringAsync(filePath, content);
      
      // Get file size
      const fileInfo = await FileSystem.getInfoAsync(filePath);
      size = 'size' in fileInfo ? fileInfo.size || 0 : 0;

      // Update export history
      await this.updateExportHistory(item, options, filePath, true);

      return {
        success: true,
        filePath,
        format: options.format,
        size,
      };
    } catch (error) {
      console.error('Export failed:', error);
      
      // Update export history with failure
      await this.updateExportHistory(item, options, '', false);

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        format: options.format,
        size: 0,
      };
    }
  }

  /**
   * Export multiple transcriptions
   */
  async exportMultipleTranscriptions(
    items: EnhancedTranscriptionItem[],
    options: ExportOptions
  ): Promise<ExportResult[]> {
    const results: ExportResult[] = [];

    for (const item of items) {
      const result = await this.exportTranscription(item, options);
      results.push(result);
    }

    return results;
  }

  /**
   * Create batch export (single file with multiple transcriptions)
   */
  async createBatchExport(
    items: EnhancedTranscriptionItem[],
    options: ExportOptions
  ): Promise<ExportResult> {
    try {
      await this.ensureExportDirectory();

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `batch-export-${timestamp}.${options.format}`;
      const filePath = `${this.exportDir}${filename}`;

      let content: string;

      switch (options.format) {
        case 'txt':
          content = this.generateBatchTextExport(items, options);
          break;
        case 'json':
          content = this.generateBatchJsonExport(items, options);
          break;
        case 'srt':
          content = this.generateBatchSrtExport(items, options);
          break;
        case 'vtt':
          content = this.generateBatchVttExport(items, options);
          break;
        default:
          throw new Error(`Batch export not supported for format: ${options.format}`);
      }

      await FileSystem.writeAsStringAsync(filePath, content);
      
      const fileInfo = await FileSystem.getInfoAsync(filePath);
      const size = 'size' in fileInfo ? fileInfo.size || 0 : 0;

      return {
        success: true,
        filePath,
        format: options.format,
        size,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        format: options.format,
        size: 0,
      };
    }
  }

  /**
   * Share exported file
   */
  async shareExportedFile(filePath: string): Promise<void> {
    const isAvailable = await Sharing.isAvailableAsync();
    if (!isAvailable) {
      throw new Error('Sharing is not available on this device');
    }

    await Sharing.shareAsync(filePath);
  }

  /**
   * Get export history for an item
   */
  getExportHistory(item: EnhancedTranscriptionItem): any[] {
    return item.exportHistory || [];
  }

  /**
   * Clean up old export files
   */
  async cleanupOldExports(maxAge: number = 7 * 24 * 60 * 60 * 1000): Promise<void> {
    try {
      const dirInfo = await FileSystem.getInfoAsync(this.exportDir);
      if (!dirInfo.exists) return;

      const files = await FileSystem.readDirectoryAsync(this.exportDir);
      const now = Date.now();

      for (const file of files) {
        const filePath = `${this.exportDir}${file}`;
        const fileInfo = await FileSystem.getInfoAsync(filePath);
        
        if ('modificationTime' in fileInfo && fileInfo.modificationTime) {
          const fileAge = now - fileInfo.modificationTime;
          if (fileAge > maxAge) {
            await FileSystem.deleteAsync(filePath);
          }
        }
      }
    } catch (error) {
      console.error('Failed to cleanup old exports:', error);
    }
  }

  /**
   * Generate text export
   */
  private generateTextExport(item: EnhancedTranscriptionItem, options: ExportOptions): string {
    let content = '';

    // Apply template if provided
    if (options.template) {
      return this.applyTemplate(item, options.template);
    }

    // Header with metadata
    if (options.includeMetadata) {
      content += `Transcription Export\n`;
      content += `==================\n\n`;
      content += `Created: ${item.createdAt.toLocaleString()}\n`;
      content += `Duration: ${this.formatDuration(item.duration)}\n`;
      content += `Category: ${item.category}\n`;
      
      if (item.confidence) {
        content += `Confidence: ${Math.round(item.confidence * 100)}%\n`;
      }
      
      if (item.tags.length > 0) {
        content += `Tags: ${item.tags.join(', ')}\n`;
      }
      
      content += `\nTranscription:\n`;
      content += `--------------\n\n`;
    }

    // Main transcription text
    content += item.transcription;

    // Timestamps if requested
    if (options.includeTimestamps && item.wordTimestamps.length > 0) {
      content += `\n\nWord Timestamps:\n`;
      content += `----------------\n`;
      
      item.wordTimestamps.forEach(timestamp => {
        content += `${this.formatTime(timestamp.startTime)} - ${this.formatTime(timestamp.endTime)}: ${timestamp.word}\n`;
      });
    }

    return content;
  }

  /**
   * Generate JSON export
   */
  private generateJsonExport(item: EnhancedTranscriptionItem, options: ExportOptions): string {
    const exportData: any = {
      id: item.id,
      transcription: item.transcription,
      duration: item.duration,
      createdAt: item.createdAt.toISOString(),
      category: item.category,
      tags: item.tags,
    };

    if (options.includeMetadata) {
      exportData.confidence = item.confidence;
      exportData.processingTime = item.processingTime;
      exportData.audioQuality = item.audioQuality;
      exportData.customMetadata = item.customMetadata;
    }

    if (options.includeTimestamps) {
      exportData.wordTimestamps = item.wordTimestamps;
      exportData.speakerSegments = item.speakerSegments;
    }

    return JSON.stringify(exportData, null, 2);
  }

  /**
   * Generate SRT subtitle export
   */
  private generateSrtExport(item: EnhancedTranscriptionItem, options: ExportOptions): string {
    let content = '';
    let subtitleIndex = 1;

    if (item.wordTimestamps.length > 0) {
      // Use word timestamps to create subtitles
      const wordsPerSubtitle = 8; // Group words into subtitles
      
      for (let i = 0; i < item.wordTimestamps.length; i += wordsPerSubtitle) {
        const wordGroup = item.wordTimestamps.slice(i, i + wordsPerSubtitle);
        const startTime = wordGroup[0].startTime;
        const endTime = wordGroup[wordGroup.length - 1].endTime;
        const text = wordGroup.map(w => w.word).join(' ');

        content += `${subtitleIndex}\n`;
        content += `${this.formatSrtTime(startTime)} --> ${this.formatSrtTime(endTime)}\n`;
        content += `${text}\n\n`;
        
        subtitleIndex++;
      }
    } else {
      // Create a single subtitle for the entire transcription
      content += `1\n`;
      content += `00:00:00,000 --> ${this.formatSrtTime(item.duration)}\n`;
      content += `${item.transcription}\n\n`;
    }

    return content;
  }

  /**
   * Generate VTT subtitle export
   */
  private generateVttExport(item: EnhancedTranscriptionItem, options: ExportOptions): string {
    let content = 'WEBVTT\n\n';

    if (options.includeMetadata) {
      content += `NOTE\n`;
      content += `Created: ${item.createdAt.toLocaleString()}\n`;
      content += `Category: ${item.category}\n\n`;
    }

    if (item.wordTimestamps.length > 0) {
      const wordsPerSubtitle = 8;
      
      for (let i = 0; i < item.wordTimestamps.length; i += wordsPerSubtitle) {
        const wordGroup = item.wordTimestamps.slice(i, i + wordsPerSubtitle);
        const startTime = wordGroup[0].startTime;
        const endTime = wordGroup[wordGroup.length - 1].endTime;
        const text = wordGroup.map(w => w.word).join(' ');

        content += `${this.formatVttTime(startTime)} --> ${this.formatVttTime(endTime)}\n`;
        content += `${text}\n\n`;
      }
    } else {
      content += `00:00:00.000 --> ${this.formatVttTime(item.duration)}\n`;
      content += `${item.transcription}\n\n`;
    }

    return content;
  }

  /**
   * Generate DOCX export (simplified HTML-like format)
   */
  private generateDocxExport(item: EnhancedTranscriptionItem, options: ExportOptions): string {
    // This is a simplified version - in a real app, you'd use a proper DOCX library
    let content = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    content += `<document>\n`;
    
    if (options.includeMetadata) {
      content += `  <header>\n`;
      content += `    <title>Transcription - ${item.createdAt.toLocaleDateString()}</title>\n`;
      content += `    <metadata>\n`;
      content += `      <created>${item.createdAt.toISOString()}</created>\n`;
      content += `      <duration>${item.duration}</duration>\n`;
      content += `      <category>${item.category}</category>\n`;
      content += `    </metadata>\n`;
      content += `  </header>\n`;
    }
    
    content += `  <body>\n`;
    content += `    <paragraph>${item.transcription}</paragraph>\n`;
    content += `  </body>\n`;
    content += `</document>\n`;

    return content;
  }

  /**
   * Generate PDF export (simplified HTML format)
   */
  private generatePdfExport(item: EnhancedTranscriptionItem, options: ExportOptions): string {
    // This is a simplified version - in a real app, you'd use a proper PDF library
    let content = `<!DOCTYPE html>\n<html>\n<head>\n`;
    content += `<title>Transcription - ${item.createdAt.toLocaleDateString()}</title>\n`;
    content += `<style>\n`;
    content += `body { font-family: Arial, sans-serif; margin: 40px; }\n`;
    content += `h1 { color: #333; }\n`;
    content += `.metadata { background: #f5f5f5; padding: 15px; margin: 20px 0; }\n`;
    content += `.transcription { line-height: 1.6; }\n`;
    content += `</style>\n</head>\n<body>\n`;
    
    content += `<h1>Audio Transcription</h1>\n`;
    
    if (options.includeMetadata) {
      content += `<div class="metadata">\n`;
      content += `<p><strong>Created:</strong> ${item.createdAt.toLocaleString()}</p>\n`;
      content += `<p><strong>Duration:</strong> ${this.formatDuration(item.duration)}</p>\n`;
      content += `<p><strong>Category:</strong> ${item.category}</p>\n`;
      if (item.tags.length > 0) {
        content += `<p><strong>Tags:</strong> ${item.tags.join(', ')}</p>\n`;
      }
      content += `</div>\n`;
    }
    
    content += `<div class="transcription">\n`;
    content += `<p>${item.transcription.replace(/\n/g, '</p>\n<p>')}</p>\n`;
    content += `</div>\n`;
    content += `</body>\n</html>`;

    return content;
  }

  /**
   * Generate batch text export
   */
  private generateBatchTextExport(items: EnhancedTranscriptionItem[], options: ExportOptions): string {
    let content = `Batch Transcription Export\n`;
    content += `=========================\n\n`;
    content += `Exported: ${new Date().toLocaleString()}\n`;
    content += `Total Items: ${items.length}\n\n`;

    items.forEach((item, index) => {
      content += `\n${'='.repeat(50)}\n`;
      content += `Transcription ${index + 1}\n`;
      content += `${'='.repeat(50)}\n\n`;
      
      if (options.includeMetadata) {
        content += `Created: ${item.createdAt.toLocaleString()}\n`;
        content += `Duration: ${this.formatDuration(item.duration)}\n`;
        content += `Category: ${item.category}\n`;
        if (item.tags.length > 0) {
          content += `Tags: ${item.tags.join(', ')}\n`;
        }
        content += `\n`;
      }
      
      content += `${item.transcription}\n`;
    });

    return content;
  }

  /**
   * Generate batch JSON export
   */
  private generateBatchJsonExport(items: EnhancedTranscriptionItem[], options: ExportOptions): string {
    const exportData = {
      exportedAt: new Date().toISOString(),
      totalItems: items.length,
      transcriptions: items.map(item => {
        const itemData: any = {
          id: item.id,
          transcription: item.transcription,
          duration: item.duration,
          createdAt: item.createdAt.toISOString(),
          category: item.category,
          tags: item.tags,
        };

        if (options.includeMetadata) {
          itemData.confidence = item.confidence;
          itemData.processingTime = item.processingTime;
          itemData.audioQuality = item.audioQuality;
        }

        if (options.includeTimestamps) {
          itemData.wordTimestamps = item.wordTimestamps;
          itemData.speakerSegments = item.speakerSegments;
        }

        return itemData;
      }),
    };

    return JSON.stringify(exportData, null, 2);
  }

  /**
   * Generate batch SRT export
   */
  private generateBatchSrtExport(items: EnhancedTranscriptionItem[], options: ExportOptions): string {
    let content = '';
    let subtitleIndex = 1;
    let currentTime = 0;

    items.forEach((item, itemIndex) => {
      // Add separator comment
      content += `\n${subtitleIndex}\n`;
      content += `${this.formatSrtTime(currentTime)} --> ${this.formatSrtTime(currentTime + 2)}\n`;
      content += `--- Transcription ${itemIndex + 1} ---\n\n`;
      subtitleIndex++;
      currentTime += 3;

      // Add transcription content
      content += `${subtitleIndex}\n`;
      content += `${this.formatSrtTime(currentTime)} --> ${this.formatSrtTime(currentTime + item.duration)}\n`;
      content += `${item.transcription}\n\n`;
      subtitleIndex++;
      currentTime += item.duration + 1;
    });

    return content;
  }

  /**
   * Generate batch VTT export
   */
  private generateBatchVttExport(items: EnhancedTranscriptionItem[], options: ExportOptions): string {
    let content = 'WEBVTT\n\n';
    let currentTime = 0;

    items.forEach((item, itemIndex) => {
      content += `NOTE Transcription ${itemIndex + 1}\n\n`;
      
      content += `${this.formatVttTime(currentTime)} --> ${this.formatVttTime(currentTime + item.duration)}\n`;
      content += `${item.transcription}\n\n`;
      
      currentTime += item.duration + 1;
    });

    return content;
  }

  /**
   * Apply custom template to transcription
   */
  private applyTemplate(item: EnhancedTranscriptionItem, template: ExportTemplate): string {
    let content = template.template;

    // Replace template variables
    const variables = {
      ...template.variables,
      transcription: item.transcription,
      date: item.createdAt.toLocaleDateString(),
      time: item.createdAt.toLocaleTimeString(),
      duration: this.formatDuration(item.duration),
      category: item.category,
      tags: item.tags.join(', '),
      confidence: item.confidence ? `${Math.round(item.confidence * 100)}%` : 'N/A',
      wordCount: item.transcription.split(/\s+/).filter(word => word.trim()).length.toString(),
    };

    Object.entries(variables).forEach(([key, value]) => {
      const regex = new RegExp(`{{${key}}}`, 'g');
      content = content.replace(regex, value);
    });

    return content;
  }

  /**
   * Ensure export directory exists
   */
  private async ensureExportDirectory(): Promise<void> {
    const dirInfo = await FileSystem.getInfoAsync(this.exportDir);
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(this.exportDir, { intermediates: true });
    }
  }

  /**
   * Update export history for an item
   */
  private async updateExportHistory(
    item: EnhancedTranscriptionItem,
    options: ExportOptions,
    filePath: string,
    success: boolean
  ): Promise<void> {
    // This would typically update the item's export history in storage
    // For now, we'll just log it
    console.log('Export history updated:', {
      itemId: item.id,
      format: options.format,
      success,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Format duration in human-readable format
   */
  private formatDuration(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    if (hours > 0) {
      return `${hours}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  /**
   * Format time for display
   */
  private formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  /**
   * Format time for SRT format
   */
  private formatSrtTime(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);
    
    return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')},${ms.toString().padStart(3, '0')}`;
  }

  /**
   * Format time for VTT format
   */
  private formatVttTime(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);
    
    return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
  }
}

// Export singleton instance
export const exportService = new ExportService();
export default exportService;