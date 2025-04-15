import React, { useEffect, useRef, useState } from 'react';
import * as monaco from 'monaco-editor';
import './App.css';

/**
 * 差异文件信息接口
 */
interface DiffFile {
  path: string;
  originalContent: string;
  modifiedContent: string;
  status: 'modified' | 'added' | 'deleted';
  language?: string;
}

/**
 * 文件树节点接口
 */
interface TreeNode {
  name: string;
  path: string;
  isDirectory: boolean;
  status?: 'modified' | 'added' | 'deleted';
  children: TreeNode[];
}

type Theme = 'vs-dark' | 'vs';
type ViewMode = 'side-by-side' | 'inline';

/**
 * Git Diff 查看器应用
 */
function App() {
  // 编辑器相关引用和状态
  const editorRef = useRef<HTMLDivElement>(null);
  const [editor, setEditor] = useState<monaco.editor.IStandaloneDiffEditor | null>(null);
  const currentFileRef = useRef<DiffFile | null>(null);
  
  // 文件和文件树相关状态
  const [diffFiles, setDiffFiles] = useState<DiffFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileTree, setFileTree] = useState<TreeNode | null>(null);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [fileTreeVisible, setFileTreeVisible] = useState<boolean>(true);
  
  // 搜索相关状态
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [searchResults, setSearchResults] = useState<DiffFile[]>([]);
  const [isSearchActive, setIsSearchActive] = useState<boolean>(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  
  // 布局相关状态
  const [treeWidth, setTreeWidth] = useState<number>(250);
  const [isResizing, setIsResizing] = useState<boolean>(false);
  const resizeStartXRef = useRef<number>(0);
  const treeWidthRef = useRef<number>(treeWidth);
  
  // 显示和用户界面相关状态
  const [viewMode, setViewMode] = useState<ViewMode>('side-by-side');
  const [theme, setTheme] = useState<Theme>('vs-dark');
  const [showWhitespace, setShowWhitespace] = useState<boolean>(true);
  const [showIndentGuides, setShowIndentGuides] = useState<boolean>(true);
  const [enableSyntaxHighlight, setEnableSyntaxHighlight] = useState<boolean>(true);
  
  // 通知相关状态
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const copyMessageTimeoutRef = useRef<number | null>(null);
  // 文件切换水印
  const [fileChangeWatermark, setFileChangeWatermark] = useState<string | null>(null);
  const fileChangeWatermarkTimeoutRef = useRef<number | null>(null);

  /**
   * 当编辑器配置变更时重新创建编辑器
   */
  useEffect(() => {
    if (!editorRef.current) return;

    // 记住当前模型
    let originalModel, modifiedModel;
    if (editor) {
      const currentModels = editor.getModel();
      if (currentModels) {
        originalModel = currentModels.original;
        modifiedModel = currentModels.modified;
      }
      
      // 销毁旧编辑器
      editor.dispose();
    }
    
    // 创建新编辑器
    const newEditor = monaco.editor.createDiffEditor(editorRef.current, {
      automaticLayout: true,
      theme,
      readOnly: true,
      renderSideBySide: viewMode === 'side-by-side',
      renderWhitespace: showWhitespace ? 'all' : 'none',
      ignoreTrimWhitespace: false,
      renderIndicators: true,
      fontSize: 13,
      guides: {
        indentation: showIndentGuides
      }
    });
    
    setEditor(newEditor);
    
    // 恢复当前文件
    if (originalModel && modifiedModel) {
      newEditor.setModel({
        original: originalModel,
        modified: modifiedModel
      });
    } else if (currentFileRef.current) {
      // 如果没有模型但有当前文件引用，使用它重新创建模型
      updateEditorContent(newEditor, currentFileRef.current);
    }
    
    return () => {
      newEditor.dispose();
    };
  }, [viewMode, theme, showWhitespace, showIndentGuides]);

  /**
   * 清除复制提示信息的定时器
   */
  useEffect(() => {
    return () => {
      if (copyMessageTimeoutRef.current) {
        window.clearTimeout(copyMessageTimeoutRef.current);
      }
      if (fileChangeWatermarkTimeoutRef.current) {
        window.clearTimeout(fileChangeWatermarkTimeoutRef.current);
      }
    };
  }, []);

  /**
   * 处理文件树调整大小
   */
  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = Math.max(150, Math.min(500, e.clientX));
      setTreeWidth(newWidth);
      treeWidthRef.current = newWidth;
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

  /**
   * 根据当前主题设置应用适当的CSS类
   */
  useEffect(() => {
    document.body.className = theme === 'vs-dark' ? 'dark-theme' : 'light-theme';
  }, [theme]);

  /**
   * 根据文件扩展名判断语言
   */
  const detectLanguage = (filename: string): string => {
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    const languageMap: Record<string, string> = {
      'js': 'javascript',
      'jsx': 'javascript',
      'ts': 'typescript',
      'tsx': 'typescript',
      'py': 'python',
      'java': 'java',
      'c': 'c',
      'cpp': 'cpp',
      'cs': 'csharp',
      'go': 'go',
      'html': 'html',
      'css': 'css',
      'scss': 'scss',
      'less': 'less',
      'json': 'json',
      'md': 'markdown',
      'xml': 'xml',
      'yml': 'yaml',
      'yaml': 'yaml',
      'sh': 'shell',
      'bash': 'shell',
      'php': 'php',
      'rb': 'ruby',
      'rust': 'rust',
      'sql': 'sql'
    };
    
    return languageMap[ext] || 'plaintext';
  };

  /**
   * 构建文件树结构
   */
  const buildFileTree = (files: DiffFile[]): TreeNode => {
    const root: TreeNode = {
      name: 'root',
      path: '',
      isDirectory: true,
      children: []
    };

    // 目录排序函数
    const compareNodes = (a: TreeNode, b: TreeNode): number => {
      if (a.isDirectory === b.isDirectory) {
        return a.name.localeCompare(b.name);
      }
      return a.isDirectory ? -1 : 1;
    };

    files.forEach(file => {
      const pathParts = file.path.split('/');
      let currentNode = root;

      // 遍历路径的每一部分
      for (let i = 0; i < pathParts.length; i++) {
        const part = pathParts[i];
        const isLastPart = i === pathParts.length - 1;
        const currentPath = pathParts.slice(0, i + 1).join('/');
        
        // 查找当前路径部分是否已存在子节点
        let found = currentNode.children.find(child => child.name === part);
        
        if (!found) {
          const newNode: TreeNode = {
            name: part,
            path: currentPath,
            isDirectory: !isLastPart,
            children: []
          };
          
          if (isLastPart) {
            newNode.status = file.status;
          }
          
          currentNode.children.push(newNode);
          currentNode.children.sort(compareNodes);
          
          found = newNode;
        }
        
        currentNode = found;
      }
    });

    // 递归排序所有子节点
    const sortTree = (node: TreeNode): void => {
      if (node.children.length) {
        node.children.sort(compareNodes);
        node.children.forEach(sortTree);
      }
    };
    
    sortTree(root);
    return root;
  };

  /**
   * 解析差异内容
   */
  const parseDiffContent = (content: string): DiffFile[] => {
    const files: DiffFile[] = [];
    const fileSections = content.split('diff --git');
    
    fileSections.forEach(section => {
      if (!section.trim()) return;

      const lines = section.split('\n');
      const filePathMatch = lines[0].match(/a\/(.*?)\s+b\/(.*)/);
      if (!filePathMatch) return;

      const [, oldPath, newPath] = filePathMatch;
      const path = newPath || oldPath;
      
      let originalContent = '';
      let modifiedContent = '';
      let isInHunk = false;
      let status: 'modified' | 'added' | 'deleted' = 'modified';

      // 检查文件状态
      if (lines.some(line => line.includes('new file mode'))) {
        status = 'added';
      } else if (lines.some(line => line.includes('deleted file mode'))) {
        status = 'deleted';
      }

      // 查找添加和删除的行
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        if (line.startsWith('@@')) {
          isInHunk = true;
          continue;
        }

        if (!isInHunk) continue;

        // 处理上下文、添加和删除的行
        if (line.startsWith('-')) {
          originalContent += line.substring(1) + '\n';
        } else if (line.startsWith('+')) {
          modifiedContent += line.substring(1) + '\n';
        } else {
          // 上下文行需要同时添加到原始和修改内容中
          // 去掉上下文行的行首第一个空格
          const contextLine = line.startsWith(' ') ? line.substring(1) : line;
          originalContent += contextLine + '\n';
          modifiedContent += contextLine + '\n';
        }
      }

      // 获取文件语言
      const language = detectLanguage(path);

      files.push({
        path,
        originalContent,
        modifiedContent,
        status,
        language
      });
    });

    return files;
  };

  /**
   * 处理文件上传
   */
  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      const parsedFiles = parseDiffContent(content);
      
      if (parsedFiles.length > 0) {
        const firstFile = parsedFiles[0];
        
        // 先设置状态
        setDiffFiles(parsedFiles);
        
        // 构建文件树
        const tree = buildFileTree(parsedFiles);
        setFileTree(tree);
        
        // 自动展开第一级目录
        if (tree.children.length > 0) {
          const newExpanded = new Set(expandedDirs);
          tree.children.forEach(child => {
            if (child.isDirectory) {
              newExpanded.add(child.path);
            }
          });
          setExpandedDirs(newExpanded);
        }
        
        // 设置选中文件并更新编辑器内容
        setSelectedFile(firstFile.path);
        currentFileRef.current = firstFile;
        updateEditorContent(editor, firstFile);
        
        // 添加短延迟确保状态更新后再显示水印
        setTimeout(() => {
          // 确保使用最新的diffFiles状态
          const currentIndex = parsedFiles.findIndex(f => f.path === firstFile.path);
          if (currentIndex >= 0) {
            // 手动构建水印内容
            setFileChangeWatermark(`
              <div class="file-path">${firstFile.path}</div>
              <div class="file-index">${currentIndex + 1} / ${parsedFiles.length}</div>
            `);
            
            // 设置定时器清除水印
            if (fileChangeWatermarkTimeoutRef.current) {
              window.clearTimeout(fileChangeWatermarkTimeoutRef.current);
            }
            
            fileChangeWatermarkTimeoutRef.current = window.setTimeout(() => {
              setFileChangeWatermark(null);
            }, 3000);
          }
        }, 200);
      }
    };
    reader.readAsText(file);
  };

  /**
   * 更新编辑器内容
   */
  const updateEditorContent = (editorInstance: monaco.editor.IStandaloneDiffEditor | null, file: DiffFile) => {
    if (!editorInstance) return;
    
    // 根据是否启用语法高亮来设置语言
    const language = enableSyntaxHighlight ? (file.language || 'plaintext') : 'plaintext';
    
    editorInstance.setModel({
      original: monaco.editor.createModel(file.originalContent, language),
      modified: monaco.editor.createModel(file.modifiedContent, language),
    });
  };

  /**
   * 显示文件切换水印
   */
  const showFileChangeWatermark = (path: string) => {
    const currentIndex = diffFiles.findIndex(file => file.path === path);
    if (currentIndex >= 0) {
      // 使用格式化的HTML结构替代简单文本
      setFileChangeWatermark(`
        <div class="file-path">${path}</div>
        <div class="file-index">${currentIndex + 1} / ${diffFiles.length}</div>
      `);
      
      // 清除之前的定时器并设置新的定时器
      if (fileChangeWatermarkTimeoutRef.current) {
        window.clearTimeout(fileChangeWatermarkTimeoutRef.current);
      }
      
      fileChangeWatermarkTimeoutRef.current = window.setTimeout(() => {
        setFileChangeWatermark(null);
      }, 3000);
    }
  };

  /**
   * 处理文件选择
   */
  const handleFileSelect = (path: string) => {
    setSelectedFile(path);
    const file = diffFiles.find(f => f.path === path);
    if (file) {
      currentFileRef.current = file;
      updateEditorContent(editor, file);
      // 显示文件切换水印
      showFileChangeWatermark(file.path);
    }
  };

  /**
   * 切换目录展开/折叠状态
   */
  const toggleDirectory = (path: string) => {
    const newExpanded = new Set(expandedDirs);
    if (newExpanded.has(path)) {
      newExpanded.delete(path);
    } else {
      newExpanded.add(path);
    }
    setExpandedDirs(newExpanded);
  };

  // UI 切换函数
  const toggleViewMode = () => setViewMode(prev => prev === 'side-by-side' ? 'inline' : 'side-by-side');
  const toggleTheme = () => setTheme(prev => prev === 'vs-dark' ? 'vs' : 'vs-dark');
  const toggleFileTree = () => setFileTreeVisible(prev => !prev);
  const toggleWhitespace = () => setShowWhitespace(prev => !prev);
  const toggleIndentGuides = () => setShowIndentGuides(prev => !prev);
  
  /**
   * 切换语法高亮
   */
  const toggleSyntaxHighlight = () => {
    // 先保存当前状态的反值，因为 setState 是异步的
    const newState = !enableSyntaxHighlight;
    setEnableSyntaxHighlight(newState);
    
    // 使用新状态值立即更新编辑器
    if (editor && currentFileRef.current) {
      // 创建新的语言模型
      const language = newState ? (currentFileRef.current.language || 'plaintext') : 'plaintext';
      
      // 更新编辑器的语言模型
      const originalModel = editor.getModel()?.original;
      const modifiedModel = editor.getModel()?.modified;
      
      if (originalModel && modifiedModel) {
        // 保存当前滚动位置和选择位置
        const originalViewState = editor.getOriginalEditor().saveViewState();
        const modifiedViewState = editor.getModifiedEditor().saveViewState();
        
        // 创建新模型替换旧模型
        const newOriginalModel = monaco.editor.createModel(
          originalModel.getValue(),
          language
        );
        const newModifiedModel = monaco.editor.createModel(
          modifiedModel.getValue(),
          language
        );
        
        // 设置新模型
        editor.setModel({
          original: newOriginalModel,
          modified: newModifiedModel
        });
        
        // 恢复滚动位置和选择位置
        if (originalViewState) {
          editor.getOriginalEditor().restoreViewState(originalViewState);
        }
        if (modifiedViewState) {
          editor.getModifiedEditor().restoreViewState(modifiedViewState);
        }
      }
    }
  };

  /**
   * 开始调整大小
   */
  const startResizing = (e: React.MouseEvent) => {
    setIsResizing(true);
    resizeStartXRef.current = e.clientX;
  };

  // =====================================================
  // 文件树操作函数
  // =====================================================

  /**
   * 展开到包含当前选中文件的所有目录
   */
  const expandToFile = (path: string) => {
    if (!path) return;
    
    const dirs = path.split('/');
    const newExpanded = new Set(expandedDirs);
    
    let currentPath = '';
    for (let i = 0; i < dirs.length - 1; i++) {
      currentPath = currentPath ? `${currentPath}/${dirs[i]}` : dirs[i];
      newExpanded.add(currentPath);
    }
    
    setExpandedDirs(newExpanded);
  };

  /**
   * 折叠所有目录
   */
  const collapseAll = () => setExpandedDirs(new Set());

  /**
   * 展开所有目录
   */
  const expandAll = () => {
    const newExpanded = new Set<string>();
    
    const addAllDirectories = (node: TreeNode, path: string) => {
      if (node.isDirectory) {
        if (path) newExpanded.add(path);
        node.children.forEach(child => {
          addAllDirectories(child, child.path);
        });
      }
    };
    
    if (fileTree) {
      addAllDirectories(fileTree, '');
    }
    
    setExpandedDirs(newExpanded);
  };

  // =====================================================
  // 路径和导航处理函数
  // =====================================================

  /**
   * 将路径分割成面包屑
   */
  const getBreadcrumbs = (path: string): {name: string, path: string}[] => {
    if (!path) return [];
    
    const parts = path.split('/');
    const breadcrumbs: {name: string, path: string}[] = [];
    
    let currentPath = '';
    for (let i = 0; i < parts.length; i++) {
      currentPath = currentPath ? `${currentPath}/${parts[i]}` : parts[i];
      breadcrumbs.push({
        name: parts[i],
        path: currentPath
      });
    }
    
    return breadcrumbs;
  };

  /**
   * 复制路径到剪贴板
   */
  const copyPathToClipboard = (path: string) => {
    navigator.clipboard.writeText(path)
      .then(() => {
        // 显示复制成功提示
        setCopyMessage(`已复制: ${path}`);
        
        // 清除之前的定时器并设置新的定时器
        if (copyMessageTimeoutRef.current) {
          window.clearTimeout(copyMessageTimeoutRef.current);
        }
        
        copyMessageTimeoutRef.current = window.setTimeout(() => {
          setCopyMessage(null);
        }, 2000);
      })
      .catch(err => {
        console.error('复制失败:', err);
        setCopyMessage('复制失败，请手动复制');
        
        if (copyMessageTimeoutRef.current) {
          window.clearTimeout(copyMessageTimeoutRef.current);
        }
        
        copyMessageTimeoutRef.current = window.setTimeout(() => {
          setCopyMessage(null);
        }, 2000);
      });
  };

  /**
   * 切换到上一个文件
   */
  const goToPreviousFile = () => {
    if (!selectedFile || diffFiles.length <= 1) return;
    
    const currentIndex = diffFiles.findIndex(file => file.path === selectedFile);
    if (currentIndex > 0) {
      const prevFile = diffFiles[currentIndex - 1];
      setSelectedFile(prevFile.path);
      currentFileRef.current = prevFile;
      updateEditorContent(editor, prevFile);
      
      // 确保目录树中文件可见
      expandToFile(prevFile.path);
      
      // 显示文件切换水印
      showFileChangeWatermark(prevFile.path);
    }
  };

  /**
   * 切换到下一个文件
   */
  const goToNextFile = () => {
    if (!selectedFile || diffFiles.length <= 1) return;
    
    const currentIndex = diffFiles.findIndex(file => file.path === selectedFile);
    if (currentIndex < diffFiles.length - 1) {
      const nextFile = diffFiles[currentIndex + 1];
      setSelectedFile(nextFile.path);
      currentFileRef.current = nextFile;
      updateEditorContent(editor, nextFile);
      
      // 确保目录树中文件可见
      expandToFile(nextFile.path);
      
      // 显示文件切换水印
      showFileChangeWatermark(nextFile.path);
    }
  };

  // =====================================================
  // 搜索相关函数
  // =====================================================

  /**
   * 处理搜索框按键事件
   */
  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Escape键关闭搜索
    if (e.key === 'Escape') {
      setIsSearchActive(false);
      setSearchQuery('');
    }

    // 上下键导航搜索结果
    if (searchResults.length > 0) {
      const currentIndex = searchResults.findIndex(file => file.path === selectedFile);
      
      // 向上导航
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (currentIndex > 0) {
          const prevFile = searchResults[currentIndex - 1];
          setSelectedFile(prevFile.path);
          currentFileRef.current = prevFile;
          updateEditorContent(editor, prevFile);
          expandToFile(prevFile.path);
        }
      }
      
      // 向下导航
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (currentIndex < searchResults.length - 1) {
          const nextFile = searchResults[currentIndex + 1];
          setSelectedFile(nextFile.path);
          currentFileRef.current = nextFile;
          updateEditorContent(editor, nextFile);
          expandToFile(nextFile.path);
        }
      }
    }
  };

  /**
   * 搜索文件函数
   */
  const searchFiles = (query: string) => {
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }
    
    const normalizedQuery = query.toLowerCase().trim();
    const results = diffFiles.filter(file => 
      file.path.toLowerCase().includes(normalizedQuery)
    );
    
    setSearchResults(results);
    
    // 如果有搜索结果，选择第一个文件
    if (results.length > 0 && normalizedQuery !== searchQuery.toLowerCase().trim()) {
      const firstResult = results[0];
      setSelectedFile(firstResult.path);
      currentFileRef.current = firstResult;
      updateEditorContent(editor, firstResult);
      expandToFile(firstResult.path);
      
      // 显示文件切换水印
      showFileChangeWatermark(firstResult.path);
    }
  };

  /**
   * 处理搜索查询变化
   */
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const query = e.target.value;
    setSearchQuery(query);
    searchFiles(query);
  };

  /**
   * 激活搜索功能
   */
  const activateSearch = () => {
    setIsSearchActive(true);
    // 使用setTimeout确保DOM更新后再聚焦
    setTimeout(() => {
      if (searchInputRef.current) {
        searchInputRef.current.focus();
      }
    }, 10);
  };

  /**
   * 切换搜索框显示状态
   */
  const toggleSearch = () => {
    if (isSearchActive) {
      setIsSearchActive(false);
      setSearchQuery('');
      setSearchResults([]);
    } else {
      activateSearch();
    }
  };

  /**
   * 清除搜索内容
   */
  const clearSearch = () => {
    setSearchQuery('');
    setSearchResults([]);
    if (searchInputRef.current) {
      searchInputRef.current.focus();
    }
  };

  // =====================================================
  // 渲染函数
  // =====================================================

  /**
   * 渲染文件树项
   */
  const renderFileTreeItem = (node: TreeNode, depth = 0) => {
    const isExpanded = expandedDirs.has(node.path);
    
    if (node.name === 'root') {
      return (
        <React.Fragment key="root">
          {node.children.map(child => renderFileTreeItem(child, depth))}
        </React.Fragment>
      );
    }

    return (
      <React.Fragment key={node.path}>
        <div 
          className={`file-tree-item ${!node.isDirectory && selectedFile === node.path ? 'selected' : ''} ${node.status || ''}`}
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
          onClick={() => node.isDirectory ? toggleDirectory(node.path) : handleFileSelect(node.path)}
          title={node.path}
        >
          <span className="file-icon">
            {node.isDirectory 
              ? (isExpanded ? '▼' : '▶') 
              : (node.status === 'added' ? '+' : node.status === 'deleted' ? '-' : 'M')
            }
          </span>
          <span className="file-name">{node.name}</span>
        </div>
        {node.isDirectory && isExpanded && node.children.map(child => renderFileTreeItem(child, depth + 1))}
      </React.Fragment>
    );
  };
  
  /**
   * 渲染面包屑导航
   */
  const renderBreadcrumbs = () => {
    if (!selectedFile) return null;
    
    // 计算导航按钮的状态
    const currentIndex = diffFiles.findIndex(file => file.path === selectedFile);
    const hasPrevious = currentIndex > 0;
    const hasNext = currentIndex < diffFiles.length - 1;
    
    return (
      <div className="breadcrumbs">
        <div className="breadcrumbs-container">
          {getBreadcrumbs(selectedFile).map((crumb, index, array) => (
            <React.Fragment key={crumb.path}>
              <span 
                className={`breadcrumb-item ${index === array.length - 1 ? 'status-' + (currentFileRef.current?.status || 'modified') : ''}`}
                onClick={() => copyPathToClipboard(crumb.path)}
                title={`点击复制: ${crumb.path}`}
              >
                {index === array.length - 1 && (
                  <span className="file-status-icon">
                    {currentFileRef.current?.status === 'added' ? '+' : 
                     currentFileRef.current?.status === 'deleted' ? '-' : 'M'}
                  </span>
                )}
                {crumb.name}
              </span>
              {index < array.length - 1 && <span className="breadcrumb-separator">/</span>}
            </React.Fragment>
          ))}
        </div>
        <div className="breadcrumbs-navigation">
          <button 
            className="navigation-button" 
            onClick={goToPreviousFile}
            disabled={!hasPrevious}
            title="上一个文件"
            aria-label="上一个文件"
          >
            <span className="icon">&#9664;</span> {/* 左三角形 */}
          </button>
          <span className="file-counter">
            {diffFiles.length > 0 ? `${currentIndex + 1}/${diffFiles.length}` : '0/0'}
          </span>
          <button 
            className="navigation-button" 
            onClick={goToNextFile}
            disabled={!hasNext}
            title="下一个文件"
            aria-label="下一个文件"
          >
            <span className="icon">&#9654;</span> {/* 右三角形 */}
          </button>
        </div>
      </div>
    );
  };

  /**
   * 渲染搜索结果项
   */
  const renderSearchResultItem = (file: DiffFile) => (
    <div 
      key={file.path}
      className={`file-tree-item search-result ${selectedFile === file.path ? 'selected' : ''} ${file.status || ''}`}
      onClick={() => handleFileSelect(file.path)}
      title={file.path}
    >
      <span className="file-icon">
        {file.status === 'added' ? '+' : file.status === 'deleted' ? '-' : 'M'}
      </span>
      <span className="file-name">{file.path}</span>
    </div>
  );

  /**
   * 渲染文件树
   */
  const renderFileTree = () => {
    if (!fileTreeVisible) return null;
    
    // 判断是否有搜索结果要显示
    const showSearchResults = searchQuery && searchResults.length > 0;
    
    return (
      <div className="file-tree-container" style={{ width: `${treeWidth}px` }}>
        <div className="file-tree-header">
          <span>文件结构</span>
          <div className="tree-actions">
            <button 
              className="tree-action-button" 
              title="展开所有" 
              onClick={expandAll}
            >
              ▼
            </button>
            <button 
              className="tree-action-button" 
              title="折叠所有" 
              onClick={collapseAll}
            >
              ▶
            </button>
            {selectedFile && (
              <button 
                className="tree-action-button" 
                title="定位到当前文件" 
                onClick={() => expandToFile(selectedFile)}
              >
                ⟳
              </button>
            )}
            <button
              className={`tree-action-button ${isSearchActive ? 'active' : ''}`}
              title={isSearchActive ? "关闭搜索" : "搜索文件"}
              onClick={toggleSearch}
            >
              &#128269; {/* 搜索图标 */}
            </button>
          </div>
        </div>
        
        {isSearchActive && (
          <div className="search-container">
            <input
              ref={searchInputRef}
              type="text"
              className="search-input"
              placeholder="搜索文件..."
              value={searchQuery}
              onChange={handleSearchChange}
              onKeyDown={handleSearchKeyDown}
            />
            <button 
              className="search-close-button"
              onClick={clearSearch}
              title="清除搜索"
            >
              &#10005; {/* X图标 */}
            </button>
            {searchQuery && (
              <div className="search-results-count">
                找到 {searchResults.length} 个结果
              </div>
            )}
          </div>
        )}
        
        <div className="file-tree">
          {fileTree && (
            showSearchResults
              ? searchResults.map(renderSearchResultItem)
              : renderFileTreeItem(fileTree)
          )}
        </div>
        <div 
          className="resize-handle"
          onMouseDown={startResizing}
          title="调整宽度"
        />
      </div>
    );
  };

  // =====================================================
  // 键盘快捷键支持
  // =====================================================

  /**
   * 添加键盘导航支持
   */
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 如果焦点在输入框中，不处理导航快捷键
      if (
        document.activeElement &&
        (document.activeElement.tagName === 'INPUT' || 
         document.activeElement.tagName === 'TEXTAREA') &&
        document.activeElement !== searchInputRef.current
      ) {
        return;
      }

      // Alt + 左箭头 或 PgUp 切换到上一个文件
      if ((e.altKey && e.key === 'ArrowLeft') || e.key === 'PageUp') {
        e.preventDefault();
        goToPreviousFile();
      }
      
      // Alt + 右箭头 或 PgDown 切换到下一个文件
      if ((e.altKey && e.key === 'ArrowRight') || e.key === 'PageDown') {
        e.preventDefault();
        goToNextFile();
      }
      
      // Ctrl + F 或 Cmd + F (Mac) 激活搜索
      if ((e.ctrlKey || e.metaKey) && e.key === 'f' && !isSearchActive) {
        e.preventDefault();
        activateSearch();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [diffFiles, selectedFile, isSearchActive]);

  // =====================================================
  // 应用界面渲染
  // =====================================================

  return (
    <div className="app">
      <div className="header">
        <div className="left-header">
          <button 
            className="icon-button toggle-tree-button" 
            title={fileTreeVisible ? "隐藏文件树" : "显示文件树"}
            onClick={toggleFileTree}
          >
            <span className="icon">{fileTreeVisible ? '◀' : '▶'}</span>
          </button>
          <h1>Git Diff 查看器</h1>
        </div>
        <div className="header-controls">
          <button 
            className={`icon-button whitespace-toggle ${showWhitespace ? 'active' : ''}`}
            title={showWhitespace ? "隐藏空格" : "显示空格"}
            onClick={toggleWhitespace}
            aria-label={showWhitespace ? "隐藏空格" : "显示空格"}
          >
            <span className="icon">&#183;</span>
          </button>
          <button 
            className={`icon-button indent-guide-toggle ${showIndentGuides ? 'active' : ''}`}
            title={showIndentGuides ? "隐藏对齐线" : "显示对齐线"}
            onClick={toggleIndentGuides}
            aria-label={showIndentGuides ? "隐藏对齐线" : "显示对齐线"}
          >
            <span className="icon">&#8214;</span>
          </button>
          <button 
            className={`icon-button syntax-highlight-toggle ${enableSyntaxHighlight ? 'active' : ''}`}
            title={enableSyntaxHighlight ? "关闭语法高亮" : "开启语法高亮"}
            onClick={toggleSyntaxHighlight}
            aria-label={enableSyntaxHighlight ? "关闭语法高亮" : "开启语法高亮"}
          >
            <span className="icon">&#9775;</span>
          </button>
          <button 
            className="icon-button view-toggle" 
            title={viewMode === 'side-by-side' ? '切换到内联视图' : '切换到并排视图'}
            onClick={toggleViewMode}
            aria-label={viewMode === 'side-by-side' ? '切换到内联视图' : '切换到并排视图'}
          >
            <span className="icon">
              {viewMode === 'side-by-side' ? '\u2637' : '\u2261'}
            </span>
          </button>
          <button
            className="icon-button theme-toggle"
            title={theme === 'vs-dark' ? '切换到亮色主题' : '切换到暗色主题'}
            onClick={toggleTheme}
            aria-label={theme === 'vs-dark' ? '切换到亮色主题' : '切换到暗色主题'}
          >
            <span className="icon">
              {theme === 'vs-dark' ? '\u2600' : '\u263D'}
            </span>
          </button>
          <label className="icon-button file-input-label" title="上传diff文件">
            <span className="icon">&#8613;</span>
            <input
              type="file"
              accept=".diff,.patch"
              onChange={handleFileUpload}
              className="file-input"
            />
          </label>
        </div>
      </div>
      <div className="main-content">
        {renderFileTree()}
        <div className="editor-section">
          {renderBreadcrumbs()}
          {copyMessage && (
            <div className="copy-message">{copyMessage}</div>
          )}
          {fileChangeWatermark && (
            <div 
              className="file-change-watermark"
              dangerouslySetInnerHTML={{ __html: fileChangeWatermark }}
            />
          )}
          <div ref={editorRef} className="editor-container" />
        </div>
      </div>
    </div>
  );
}

export default App;