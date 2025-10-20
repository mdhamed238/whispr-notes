# Audio Transcription App - Workflow Diagram

This document contains a comprehensive mermaid workflow diagram that illustrates the complete flow of the audio transcription application from initialization to transcription completion.

## Application Workflow

```mermaid
graph TD
    A[App Launch] --> B[Initialize React Native App]
    B --> C[Load useSpeechToText Hook]
    C --> D{Model Download Status}
    
    D -->|Model Not Downloaded| E[Display Download Progress]
    D -->|Model Ready| F[Set Model Available = true]
    
    E --> E1[Download Whisper Tiny Model]
    E1 --> E2{Download Complete?}
    E2 -->|Success| F
    E2 -->|Failed| E3[Show Error Message]
    E3 --> E
    
    F --> G[Set Global Model Instance]
    G --> H[Initialize Services]
    
    H --> I[Audio Service Init]
    H --> J[Transcription Service Init]
    H --> K[Storage Service Init]
    
    I --> L[Request Microphone Permissions]
    J --> M[Verify Model Instance]
    K --> N[Load Saved Transcriptions]
    
    L --> O[Main UI Ready]
    M --> O
    N --> O
    
    O --> P[User Interaction]
    
    P --> Q{User Action}
    
    Q -->|Press Record| R[Start Recording Flow]
    Q -->|Press Play| S[Play Audio Flow]
    Q -->|Press Transcribe| T[Transcription Flow]
    Q -->|Press Save| U[Save Transcription Flow]
    Q -->|Press Reset| V[Reset Flow]
    
    %% Recording Flow
    R --> R1[Check Microphone Permission]
    R1 --> R2{Permission Granted?}
    R2 -->|No| R3[Show Permission Error]
    R2 -->|Yes| R4[Create Audio Directory]
    R4 --> R5[Generate Unique Filename]
    R5 --> R6[Start Audio Recording]
    R6 --> R7[Update UI - Recording State]
    R7 --> R8[Start Duration Timer]
    R8 --> R9{User Stops Recording?}
    R9 -->|No| R8
    R9 -->|Yes| R10[Stop Recording]
    R10 --> R11[Save Audio File]
    R11 --> R12[Update UI - Stopped State]
    R12 --> O
    
    %% Play Audio Flow
    S --> S1{Audio File Exists?}
    S1 -->|No| S2[Show No Audio Error]
    S1 -->|Yes| S3[Load Audio File]
    S3 --> S4[Start Playback]
    S4 --> S5[Update UI - Playing State]
    S5 --> S6{Playback Complete?}
    S6 -->|No| S5
    S6 -->|Yes| S7[Update UI - Idle State]
    S7 --> O
    
    %% Transcription Flow
    T --> T1{Model Available?}
    T1 -->|No| T2[Show Model Not Available Error]
    T2 --> O
    T1 -->|Yes| T3{Audio File Exists?}
    T3 -->|No| T4[Show No Audio Error]
    T4 --> O
    T3 -->|Yes| T5[Start Transcription Process]
    
    T5 --> T6[Stage 1: Preprocessing Audio]
    T6 --> T7[Load Audio File]
    T7 --> T8[Create AudioContext 16kHz]
    T8 --> T9[Decode Audio Data]
    T9 --> T10[Extract Mono Channel]
    T10 --> T11[Convert to Float32Array]
    T11 --> T12[Update Progress: 30%]
    
    T12 --> T13[Stage 2: Model Loading]
    T13 --> T14[Verify Model Instance]
    T14 --> T15[Initialize Inference Engine]
    T15 --> T16[Update Progress: 50%]
    
    T16 --> T17[Stage 3: AI Inference]
    T17 --> T18[Run Whisper Model]
    T18 --> T19[Process Audio Through Neural Network]
    T19 --> T20{Transcription Successful?}
    T20 -->|No| T21[Handle Inference Error]
    T21 --> T22[Show Error Message]
    T22 --> O
    
    T20 -->|Yes| T23[Update Progress: 90%]
    T23 --> T24[Stage 4: Post-Processing]
    T24 --> T25[Clean Raw Transcription]
    T25 --> T26[Capitalize First Letter]
    T26 --> T27[Add Punctuation]
    T27 --> T28[Update Progress: 100%]
    T28 --> T29[Display Transcription Result]
    T29 --> O
    
    %% Save Transcription Flow
    U --> U1{Transcription Available?}
    U1 -->|No| U2[Show No Transcription Error]
    U1 -->|Yes| U3[Create Transcription Item]
    U3 --> U4[Generate Unique ID]
    U4 --> U5[Store Audio URI]
    U5 --> U6[Store Transcription Text]
    U6 --> U7[Store Metadata]
    U7 --> U8[Save to AsyncStorage]
    U8 --> U9[Show Success Message]
    U9 --> U10[Reset UI State]
    U10 --> O
    
    %% Reset Flow
    V --> V1[Clear Audio URI]
    V1 --> V2[Clear Transcription Text]
    V2 --> V3[Reset Duration Counter]
    V3 --> V4[Stop Any Playback]
    V4 --> V5[Cleanup Audio Resources]
    V5 --> O
    
    %% Error Handling
    R3 --> O
    S2 --> O
    T2 --> O
    T4 --> O
    U2 --> O
    
    %% Styling
    classDef initClass fill:#e1f5fe,stroke:#01579b,stroke-width:2px
    classDef actionClass fill:#f3e5f5,stroke:#4a148c,stroke-width:2px
    classDef processClass fill:#e8f5e8,stroke:#1b5e20,stroke-width:2px
    classDef errorClass fill:#ffebee,stroke:#b71c1c,stroke-width:2px
    classDef decisionClass fill:#fff3e0,stroke:#e65100,stroke-width:2px
    
    class A,B,C,H,I,J,K initClass
    class P,Q,R,S,T,U,V actionClass
    class T6,T7,T8,T9,T10,T11,T17,T18,T19,T24,T25,T26,T27 processClass
    class R3,S2,T2,T4,T21,T22,U2,E3 errorClass
    class D,E2,R2,S1,T1,T3,T20,U1 decisionClass
```

## Component Interaction Diagram

```mermaid
graph LR
    subgraph "React Native App"
        A[index.tsx]
        B[useSpeechToText Hook]
    end
    
    subgraph "Services Layer"
        C[audioService.ts]
        D[transcriptionService.ts]
        E[storageService.ts]
        F[modelManager.ts]
    end
    
    subgraph "External Libraries"
        G[react-native-executorch]
        H[react-native-audio-api]
        I[expo-audio]
        J[@react-native-async-storage]
    end
    
    subgraph "Native Modules"
        K[Android Audio HAL]
        L[iOS Audio Session]
        M[Hardware Microphone]
    end
    
    subgraph "AI Model"
        N[Whisper Tiny Model]
        O[ExecuTorch Runtime]
    end
    
    A --> C
    A --> D
    A --> E
    A --> B
    
    B --> G
    B --> N
    G --> O
    
    C --> H
    C --> I
    D --> G
    E --> J
    
    H --> K
    H --> L
    I --> K
    I --> L
    
    K --> M
    L --> M
    
    %% Data Flow
    A -.->|"Audio URI"| C
    C -.->|"Float32Array"| D
    D -.->|"Transcription"| A
    A -.->|"Save Data"| E
    E -.->|"Retrieved Data"| A
    
    classDef uiClass fill:#e3f2fd,stroke:#0277bd,stroke-width:2px
    classDef serviceClass fill:#f1f8e9,stroke:#388e3c,stroke-width:2px
    classDef libClass fill:#fce4ec,stroke:#c2185b,stroke-width:2px
    classDef nativeClass fill:#fff8e1,stroke:#f57c00,stroke-width:2px
    classDef aiClass fill:#f3e5f5,stroke:#7b1fa2,stroke-width:2px
    
    class A,B uiClass
    class C,D,E,F serviceClass
    class G,H,I,J libClass
    class K,L,M nativeClass
    class N,O aiClass
```

## State Management Flow

```mermaid
stateDiagram-v2
    [*] --> AppInitializing
    
    AppInitializing --> ModelDownloading : Model not available
    AppInitializing --> Ready : Model available
    
    ModelDownloading --> ModelDownloading : Download in progress
    ModelDownloading --> Ready : Download complete
    ModelDownloading --> Error : Download failed
    
    Ready --> Recording : User starts recording
    Ready --> Playing : User plays audio
    Ready --> Transcribing : User starts transcription
    
    Recording --> Ready : Recording stopped
    Recording --> Error : Recording failed
    
    Playing --> Ready : Playback complete
    Playing --> Ready : User stops playback
    Playing --> Error : Playback failed
    
    Transcribing --> Preprocessing : Audio preprocessing
    Preprocessing --> ModelLoading : Audio ready
    ModelLoading --> Inference : Model loaded
    Inference --> PostProcessing : Inference complete
    PostProcessing --> TranscriptionComplete : Processing done
    TranscriptionComplete --> Ready : Result displayed
    
    Transcribing --> Error : Transcription failed
    Preprocessing --> Error : Preprocessing failed
    ModelLoading --> Error : Model loading failed
    Inference --> Error : Inference failed
    PostProcessing --> Error : Post-processing failed
    
    Error --> Ready : User acknowledges error
    
    Ready --> Saving : User saves transcription
    Saving --> Ready : Save complete
    Saving --> Error : Save failed
    
    Ready --> Resetting : User resets
    Resetting --> Ready : Reset complete
```

## Data Flow Architecture

```mermaid
flowchart TB
    subgraph "User Interface Layer"
        UI[React Native UI Components]
        HOOKS[React Hooks & State]
    end
    
    subgraph "Business Logic Layer"
        AS[Audio Service]
        TS[Transcription Service]
        SS[Storage Service]
    end
    
    subgraph "Native Bridge Layer"
        RNE[react-native-executorch]
        RNA[react-native-audio-api]
        EXPO[expo-audio]
    end
    
    subgraph "Platform Layer"
        ANDROID[Android Native]
        IOS[iOS Native]
    end
    
    subgraph "Hardware Layer"
        MIC[Microphone]
        STORAGE[Device Storage]
        CPU[CPU/NPU]
    end
    
    UI --> HOOKS
    HOOKS --> AS
    HOOKS --> TS
    HOOKS --> SS
    
    AS --> RNA
    AS --> EXPO
    TS --> RNE
    SS --> ANDROID
    SS --> IOS
    
    RNA --> ANDROID
    RNA --> IOS
    EXPO --> ANDROID
    EXPO --> IOS
    RNE --> ANDROID
    RNE --> IOS
    
    ANDROID --> MIC
    ANDROID --> STORAGE
    ANDROID --> CPU
    IOS --> MIC
    IOS --> STORAGE
    IOS --> CPU
    
    %% Data flow arrows
    MIC -.->|Audio Data| ANDROID
    MIC -.->|Audio Data| IOS
    ANDROID -.->|Processed Audio| RNA
    IOS -.->|Processed Audio| RNA
    RNA -.->|Float32Array| AS
    AS -.->|Audio Data| TS
    TS -.->|Transcription| HOOKS
    HOOKS -.->|Display| UI
```

## Performance and Error Handling

```mermaid
graph TD
    A[Performance Monitoring] --> B[Memory Usage Check]
    A --> C[Processing Time Check]
    A --> D[Storage Space Check]
    
    B --> B1{Memory > 500MB?}
    C --> C1{Time > 5 minutes?}
    D --> D1{Free Space < 100MB?}
    
    B1 -->|Yes| E[Memory Warning]
    C1 -->|Yes| F[Timeout Error]
    D1 -->|Yes| G[Storage Warning]
    
    B1 -->|No| H[Continue Processing]
    C1 -->|No| H
    D1 -->|No| H
    
    E --> I[Optimize Memory Usage]
    F --> J[Cancel Operation]
    G --> K[Cleanup Old Files]
    
    I --> L[Retry Operation]
    J --> M[Show Error Message]
    K --> L
    
    L --> N{Retry Successful?}
    N -->|Yes| H
    N -->|No| M
    
    M --> O[Log Error Details]
    O --> P[User Action Required]
    
    H --> Q[Operation Complete]
```

## Key Features Highlighted in Workflow

### 1. **Model Management**
- Automatic download of Whisper Tiny model on first launch
- Progress tracking during download
- Model readiness verification before transcription

### 2. **Audio Processing Pipeline**
- 16kHz mono WAV format optimization for Whisper
- Real-time audio recording with duration tracking
- Audio preprocessing using react-native-audio-api
- Format conversion to Float32Array for AI model

### 3. **AI Transcription Process**
- On-device processing using react-native-executorch
- Staged progress reporting (preprocessing, loading, inference, decoding)
- Error handling at each stage
- Post-processing for better readability

### 4. **State Management**
- Comprehensive state tracking for recording, playback, and transcription
- Global model instance management
- Cleanup and resource management

### 5. **User Experience**
- Haptic feedback for user interactions
- Real-time progress updates
- Clear error messages and recovery paths
- Auto-save functionality

### 6. **Data Persistence**
- AsyncStorage for transcriptions and settings
- File system management for audio files
- Export capabilities for transcriptions

This workflow diagram provides a complete overview of how the audio transcription app functions, from user interaction to AI processing and data persistence.
