-- Caso de estudio: Universidad del Valle. SQL Server / exportación estilo SSMS.
-- Las dependencias del negocio están en caso-universidad.reglas.json.
USE [UniversidadDemo];
GO
SET ANSI_NULLS ON;
GO
SET QUOTED_IDENTIFIER ON;
GO
CREATE TABLE [dbo].[Facultades] (
    [FacultadId] INT NOT NULL,
    [FacultadNombre] NVARCHAR(120) NOT NULL,
    [Decano] NVARCHAR(120) NOT NULL
 ) ON [PRIMARY];
GO
ALTER TABLE [dbo].[Facultades] ADD CONSTRAINT [PK_Facultades] PRIMARY KEY CLUSTERED ([FacultadId] ASC);
GO
CREATE TABLE [dbo].[Carreras] (
    [CarreraId] INT NOT NULL,
    [CarreraNombre] NVARCHAR(120) NOT NULL,
    [FacultadId] INT NOT NULL
 ) ON [PRIMARY];
GO
ALTER TABLE [dbo].[Carreras] ADD CONSTRAINT [PK_Carreras] PRIMARY KEY CLUSTERED ([CarreraId] ASC);
GO
CREATE TABLE [dbo].[Estudiantes] (
    [EstudianteId] INT NOT NULL,
    [Matricula] VARCHAR(20) NOT NULL,
    [EstudianteNombre] NVARCHAR(120) NOT NULL,
    [Correo] VARCHAR(150) NOT NULL,
    [CarreraId] INT NOT NULL,
    CONSTRAINT [UQ_Matricula] UNIQUE NONCLUSTERED ([Matricula] ASC)
 ) ON [PRIMARY];
GO
ALTER TABLE [dbo].[Estudiantes] ADD CONSTRAINT [PK_Estudiantes] PRIMARY KEY CLUSTERED ([EstudianteId] ASC);
GO
CREATE TABLE [dbo].[Docentes] (
    [DocenteId] INT NOT NULL,
    [DocenteNombre] NVARCHAR(120) NOT NULL,
    [Especialidad] NVARCHAR(120) NOT NULL
 ) ON [PRIMARY];
GO
ALTER TABLE [dbo].[Docentes] ADD CONSTRAINT [PK_Docentes] PRIMARY KEY CLUSTERED ([DocenteId] ASC);
GO
CREATE TABLE [dbo].[Asignaturas] (
    [AsignaturaId] INT NOT NULL,
    [AsignaturaNombre] NVARCHAR(120) NOT NULL,
    [Creditos] INT NOT NULL
 ) ON [PRIMARY];
GO
ALTER TABLE [dbo].[Asignaturas] ADD CONSTRAINT [PK_Asignaturas] PRIMARY KEY CLUSTERED ([AsignaturaId] ASC);
GO
CREATE TABLE [dbo].[Edificios] (
    [EdificioId] INT NOT NULL,
    [EdificioNombre] NVARCHAR(80) NOT NULL,
    [Direccion] NVARCHAR(200) NOT NULL
 ) ON [PRIMARY];
GO
ALTER TABLE [dbo].[Edificios] ADD CONSTRAINT [PK_Edificios] PRIMARY KEY CLUSTERED ([EdificioId] ASC);
GO
CREATE TABLE [dbo].[Aulas] (
    [AulaId] INT NOT NULL,
    [AulaNombre] NVARCHAR(40) NOT NULL,
    [EdificioId] INT NOT NULL,
    [Capacidad] INT NOT NULL
 ) ON [PRIMARY];
GO
ALTER TABLE [dbo].[Aulas] ADD CONSTRAINT [PK_Aulas] PRIMARY KEY CLUSTERED ([AulaId] ASC);
GO
CREATE TABLE [dbo].[Periodos] (
    [PeriodoId] INT NOT NULL,
    [PeriodoNombre] NVARCHAR(40) NOT NULL,
    [Inicio] DATE NOT NULL,
    [Fin] DATE NOT NULL
 ) ON [PRIMARY];
GO
ALTER TABLE [dbo].[Periodos] ADD CONSTRAINT [PK_Periodos] PRIMARY KEY CLUSTERED ([PeriodoId] ASC);
GO
CREATE TABLE [dbo].[Secciones] (
    [SeccionId] INT NOT NULL,
    [AsignaturaId] INT NOT NULL,
    [DocenteId] INT NOT NULL,
    [AulaId] INT NOT NULL,
    [PeriodoId] INT NOT NULL,
    [Horario] NVARCHAR(80) NOT NULL
 ) ON [PRIMARY];
GO
ALTER TABLE [dbo].[Secciones] ADD CONSTRAINT [PK_Secciones] PRIMARY KEY CLUSTERED ([SeccionId] ASC);
GO
CREATE TABLE [dbo].[Becas] (
    [BecaId] INT NOT NULL,
    [BecaNombre] NVARCHAR(100) NOT NULL,
    [Porcentaje] DECIMAL(5,2) NOT NULL
 ) ON [PRIMARY];
GO
ALTER TABLE [dbo].[Becas] ADD CONSTRAINT [PK_Becas] PRIMARY KEY CLUSTERED ([BecaId] ASC);
GO
CREATE TABLE [dbo].[InscripcionesExtendidas] (
    [EstudianteId] INT NOT NULL,
    [SeccionId] INT NOT NULL,
    [EstudianteNombre] NVARCHAR(120) NOT NULL,
    [Matricula] VARCHAR(20) NOT NULL,
    [Correo] VARCHAR(150) NOT NULL,
    [CarreraId] INT NOT NULL,
    [CarreraNombre] NVARCHAR(120) NOT NULL,
    [FacultadId] INT NOT NULL,
    [FacultadNombre] NVARCHAR(120) NOT NULL,
    [Decano] NVARCHAR(120) NOT NULL,
    [AsignaturaId] INT NOT NULL,
    [AsignaturaNombre] NVARCHAR(120) NOT NULL,
    [Creditos] INT NOT NULL,
    [DocenteId] INT NOT NULL,
    [DocenteNombre] NVARCHAR(120) NOT NULL,
    [Especialidad] NVARCHAR(120) NOT NULL,
    [AulaId] INT NOT NULL,
    [AulaNombre] NVARCHAR(40) NOT NULL,
    [Capacidad] INT NOT NULL,
    [EdificioId] INT NOT NULL,
    [EdificioNombre] NVARCHAR(80) NOT NULL,
    [Direccion] NVARCHAR(200) NOT NULL,
    [PeriodoId] INT NOT NULL,
    [PeriodoNombre] NVARCHAR(40) NOT NULL,
    [Inicio] DATE NOT NULL,
    [Fin] DATE NOT NULL,
    [Horario] NVARCHAR(80) NOT NULL,
    [BecaId] INT NOT NULL,
    [BecaNombre] NVARCHAR(100) NOT NULL,
    [Porcentaje] DECIMAL(5,2) NOT NULL,
    [FechaInscripcion] DATETIME2(3) NOT NULL,
    [NotaFinal] DECIMAL(5,2) NOT NULL,
    [Estado] NVARCHAR(20) NOT NULL,
    [Observaciones] NVARCHAR(MAX) NOT NULL,
    CONSTRAINT PK_Inscripciones PRIMARY KEY (EstudianteId, SeccionId)
);
GO
CREATE TABLE [dbo].[ContactosEmergencia] (EstudianteId INT NOT NULL PRIMARY KEY, Telefono1 NVARCHAR(30), Telefono2 NVARCHAR(30), Telefono3 NVARCHAR(30));
GO
ALTER TABLE [dbo].[Carreras] WITH CHECK ADD CONSTRAINT [FK_0] FOREIGN KEY ([FacultadId]) REFERENCES [dbo].[Facultades] ([FacultadId]);
GO
ALTER TABLE [dbo].[Estudiantes] WITH CHECK ADD CONSTRAINT [FK_1] FOREIGN KEY ([CarreraId]) REFERENCES [dbo].[Carreras] ([CarreraId]);
GO
ALTER TABLE [dbo].[Aulas] WITH CHECK ADD CONSTRAINT [FK_2] FOREIGN KEY ([EdificioId]) REFERENCES [dbo].[Edificios] ([EdificioId]);
GO
ALTER TABLE [dbo].[Secciones] WITH CHECK ADD CONSTRAINT [FK_3] FOREIGN KEY ([DocenteId]) REFERENCES [dbo].[Docentes] ([DocenteId]);
GO
ALTER TABLE [dbo].[Secciones] WITH CHECK ADD CONSTRAINT [FK_4] FOREIGN KEY ([AsignaturaId]) REFERENCES [dbo].[Asignaturas] ([AsignaturaId]);
GO
ALTER TABLE [dbo].[Secciones] WITH CHECK ADD CONSTRAINT [FK_5] FOREIGN KEY ([AulaId]) REFERENCES [dbo].[Aulas] ([AulaId]);
GO
ALTER TABLE [dbo].[Secciones] WITH CHECK ADD CONSTRAINT [FK_6] FOREIGN KEY ([PeriodoId]) REFERENCES [dbo].[Periodos] ([PeriodoId]);
GO
ALTER TABLE [dbo].[ContactosEmergencia] WITH CHECK ADD CONSTRAINT [FK_7] FOREIGN KEY ([EstudianteId]) REFERENCES [dbo].[Estudiantes] ([EstudianteId]);
GO
-- Datos de demostración: se ignoran durante el análisis, nunca se ejecutan.
INSERT INTO [dbo].[Docentes] VALUES (1, N'Docente 1', N'Especialidad 1');
INSERT INTO [dbo].[Docentes] VALUES (2, N'Docente 2', N'Especialidad 2');
INSERT INTO [dbo].[Docentes] VALUES (3, N'Docente 3', N'Especialidad 3');
INSERT INTO [dbo].[Docentes] VALUES (4, N'Docente 4', N'Especialidad 4');
INSERT INTO [dbo].[Docentes] VALUES (5, N'Docente 5', N'Especialidad 5');
INSERT INTO [dbo].[Docentes] VALUES (6, N'Docente 6', N'Especialidad 6');
INSERT INTO [dbo].[Docentes] VALUES (7, N'Docente 7', N'Especialidad 7');
INSERT INTO [dbo].[Docentes] VALUES (8, N'Docente 8', N'Especialidad 8');
INSERT INTO [dbo].[Docentes] VALUES (9, N'Docente 9', N'Especialidad 9');
INSERT INTO [dbo].[Docentes] VALUES (10, N'Docente 10', N'Especialidad 0');
INSERT INTO [dbo].[Docentes] VALUES (11, N'Docente 11', N'Especialidad 1');
INSERT INTO [dbo].[Docentes] VALUES (12, N'Docente 12', N'Especialidad 2');
INSERT INTO [dbo].[Docentes] VALUES (13, N'Docente 13', N'Especialidad 3');
INSERT INTO [dbo].[Docentes] VALUES (14, N'Docente 14', N'Especialidad 4');
INSERT INTO [dbo].[Docentes] VALUES (15, N'Docente 15', N'Especialidad 5');
INSERT INTO [dbo].[Docentes] VALUES (16, N'Docente 16', N'Especialidad 6');
INSERT INTO [dbo].[Docentes] VALUES (17, N'Docente 17', N'Especialidad 7');
INSERT INTO [dbo].[Docentes] VALUES (18, N'Docente 18', N'Especialidad 8');
INSERT INTO [dbo].[Docentes] VALUES (19, N'Docente 19', N'Especialidad 9');
INSERT INTO [dbo].[Docentes] VALUES (20, N'Docente 20', N'Especialidad 0');
INSERT INTO [dbo].[Docentes] VALUES (21, N'Docente 21', N'Especialidad 1');
INSERT INTO [dbo].[Docentes] VALUES (22, N'Docente 22', N'Especialidad 2');
INSERT INTO [dbo].[Docentes] VALUES (23, N'Docente 23', N'Especialidad 3');
INSERT INTO [dbo].[Docentes] VALUES (24, N'Docente 24', N'Especialidad 4');
INSERT INTO [dbo].[Docentes] VALUES (25, N'Docente 25', N'Especialidad 5');
INSERT INTO [dbo].[Docentes] VALUES (26, N'Docente 26', N'Especialidad 6');
INSERT INTO [dbo].[Docentes] VALUES (27, N'Docente 27', N'Especialidad 7');
INSERT INTO [dbo].[Docentes] VALUES (28, N'Docente 28', N'Especialidad 8');
INSERT INTO [dbo].[Docentes] VALUES (29, N'Docente 29', N'Especialidad 9');
INSERT INTO [dbo].[Docentes] VALUES (30, N'Docente 30', N'Especialidad 0');
INSERT INTO [dbo].[Docentes] VALUES (31, N'Docente 31', N'Especialidad 1');
INSERT INTO [dbo].[Docentes] VALUES (32, N'Docente 32', N'Especialidad 2');
INSERT INTO [dbo].[Docentes] VALUES (33, N'Docente 33', N'Especialidad 3');
INSERT INTO [dbo].[Docentes] VALUES (34, N'Docente 34', N'Especialidad 4');
INSERT INTO [dbo].[Docentes] VALUES (35, N'Docente 35', N'Especialidad 5');
INSERT INTO [dbo].[Docentes] VALUES (36, N'Docente 36', N'Especialidad 6');
INSERT INTO [dbo].[Docentes] VALUES (37, N'Docente 37', N'Especialidad 7');
INSERT INTO [dbo].[Docentes] VALUES (38, N'Docente 38', N'Especialidad 8');
INSERT INTO [dbo].[Docentes] VALUES (39, N'Docente 39', N'Especialidad 9');
INSERT INTO [dbo].[Docentes] VALUES (40, N'Docente 40', N'Especialidad 0');
INSERT INTO [dbo].[Docentes] VALUES (41, N'Docente 41', N'Especialidad 1');
INSERT INTO [dbo].[Docentes] VALUES (42, N'Docente 42', N'Especialidad 2');
INSERT INTO [dbo].[Docentes] VALUES (43, N'Docente 43', N'Especialidad 3');
INSERT INTO [dbo].[Docentes] VALUES (44, N'Docente 44', N'Especialidad 4');
INSERT INTO [dbo].[Docentes] VALUES (45, N'Docente 45', N'Especialidad 5');
INSERT INTO [dbo].[Docentes] VALUES (46, N'Docente 46', N'Especialidad 6');
INSERT INTO [dbo].[Docentes] VALUES (47, N'Docente 47', N'Especialidad 7');
INSERT INTO [dbo].[Docentes] VALUES (48, N'Docente 48', N'Especialidad 8');
INSERT INTO [dbo].[Docentes] VALUES (49, N'Docente 49', N'Especialidad 9');
INSERT INTO [dbo].[Docentes] VALUES (50, N'Docente 50', N'Especialidad 0');
INSERT INTO [dbo].[Docentes] VALUES (51, N'Docente 51', N'Especialidad 1');
INSERT INTO [dbo].[Docentes] VALUES (52, N'Docente 52', N'Especialidad 2');
INSERT INTO [dbo].[Docentes] VALUES (53, N'Docente 53', N'Especialidad 3');
INSERT INTO [dbo].[Docentes] VALUES (54, N'Docente 54', N'Especialidad 4');
INSERT INTO [dbo].[Docentes] VALUES (55, N'Docente 55', N'Especialidad 5');
INSERT INTO [dbo].[Docentes] VALUES (56, N'Docente 56', N'Especialidad 6');
INSERT INTO [dbo].[Docentes] VALUES (57, N'Docente 57', N'Especialidad 7');
INSERT INTO [dbo].[Docentes] VALUES (58, N'Docente 58', N'Especialidad 8');
INSERT INTO [dbo].[Docentes] VALUES (59, N'Docente 59', N'Especialidad 9');
INSERT INTO [dbo].[Docentes] VALUES (60, N'Docente 60', N'Especialidad 0');
INSERT INTO [dbo].[Docentes] VALUES (61, N'Docente 61', N'Especialidad 1');
INSERT INTO [dbo].[Docentes] VALUES (62, N'Docente 62', N'Especialidad 2');
INSERT INTO [dbo].[Docentes] VALUES (63, N'Docente 63', N'Especialidad 3');
INSERT INTO [dbo].[Docentes] VALUES (64, N'Docente 64', N'Especialidad 4');
INSERT INTO [dbo].[Docentes] VALUES (65, N'Docente 65', N'Especialidad 5');
INSERT INTO [dbo].[Docentes] VALUES (66, N'Docente 66', N'Especialidad 6');
INSERT INTO [dbo].[Docentes] VALUES (67, N'Docente 67', N'Especialidad 7');
INSERT INTO [dbo].[Docentes] VALUES (68, N'Docente 68', N'Especialidad 8');
INSERT INTO [dbo].[Docentes] VALUES (69, N'Docente 69', N'Especialidad 9');
INSERT INTO [dbo].[Docentes] VALUES (70, N'Docente 70', N'Especialidad 0');
INSERT INTO [dbo].[Docentes] VALUES (71, N'Docente 71', N'Especialidad 1');
INSERT INTO [dbo].[Docentes] VALUES (72, N'Docente 72', N'Especialidad 2');
INSERT INTO [dbo].[Docentes] VALUES (73, N'Docente 73', N'Especialidad 3');
INSERT INTO [dbo].[Docentes] VALUES (74, N'Docente 74', N'Especialidad 4');
INSERT INTO [dbo].[Docentes] VALUES (75, N'Docente 75', N'Especialidad 5');
INSERT INTO [dbo].[Docentes] VALUES (76, N'Docente 76', N'Especialidad 6');
INSERT INTO [dbo].[Docentes] VALUES (77, N'Docente 77', N'Especialidad 7');
INSERT INTO [dbo].[Docentes] VALUES (78, N'Docente 78', N'Especialidad 8');
INSERT INTO [dbo].[Docentes] VALUES (79, N'Docente 79', N'Especialidad 9');
INSERT INTO [dbo].[Docentes] VALUES (80, N'Docente 80', N'Especialidad 0');
INSERT INTO [dbo].[Docentes] VALUES (81, N'Docente 81', N'Especialidad 1');
INSERT INTO [dbo].[Docentes] VALUES (82, N'Docente 82', N'Especialidad 2');
INSERT INTO [dbo].[Docentes] VALUES (83, N'Docente 83', N'Especialidad 3');
INSERT INTO [dbo].[Docentes] VALUES (84, N'Docente 84', N'Especialidad 4');
INSERT INTO [dbo].[Docentes] VALUES (85, N'Docente 85', N'Especialidad 5');
INSERT INTO [dbo].[Docentes] VALUES (86, N'Docente 86', N'Especialidad 6');
INSERT INTO [dbo].[Docentes] VALUES (87, N'Docente 87', N'Especialidad 7');
INSERT INTO [dbo].[Docentes] VALUES (88, N'Docente 88', N'Especialidad 8');
INSERT INTO [dbo].[Docentes] VALUES (89, N'Docente 89', N'Especialidad 9');
INSERT INTO [dbo].[Docentes] VALUES (90, N'Docente 90', N'Especialidad 0');
INSERT INTO [dbo].[Docentes] VALUES (91, N'Docente 91', N'Especialidad 1');
INSERT INTO [dbo].[Docentes] VALUES (92, N'Docente 92', N'Especialidad 2');
INSERT INTO [dbo].[Docentes] VALUES (93, N'Docente 93', N'Especialidad 3');
INSERT INTO [dbo].[Docentes] VALUES (94, N'Docente 94', N'Especialidad 4');
INSERT INTO [dbo].[Docentes] VALUES (95, N'Docente 95', N'Especialidad 5');
INSERT INTO [dbo].[Docentes] VALUES (96, N'Docente 96', N'Especialidad 6');
INSERT INTO [dbo].[Docentes] VALUES (97, N'Docente 97', N'Especialidad 7');
INSERT INTO [dbo].[Docentes] VALUES (98, N'Docente 98', N'Especialidad 8');
INSERT INTO [dbo].[Docentes] VALUES (99, N'Docente 99', N'Especialidad 9');
INSERT INTO [dbo].[Docentes] VALUES (100, N'Docente 100', N'Especialidad 0');
INSERT INTO [dbo].[Docentes] VALUES (101, N'Docente 101', N'Especialidad 1');
INSERT INTO [dbo].[Docentes] VALUES (102, N'Docente 102', N'Especialidad 2');
INSERT INTO [dbo].[Docentes] VALUES (103, N'Docente 103', N'Especialidad 3');
INSERT INTO [dbo].[Docentes] VALUES (104, N'Docente 104', N'Especialidad 4');
INSERT INTO [dbo].[Docentes] VALUES (105, N'Docente 105', N'Especialidad 5');
INSERT INTO [dbo].[Docentes] VALUES (106, N'Docente 106', N'Especialidad 6');
INSERT INTO [dbo].[Docentes] VALUES (107, N'Docente 107', N'Especialidad 7');
INSERT INTO [dbo].[Docentes] VALUES (108, N'Docente 108', N'Especialidad 8');
INSERT INTO [dbo].[Docentes] VALUES (109, N'Docente 109', N'Especialidad 9');
INSERT INTO [dbo].[Docentes] VALUES (110, N'Docente 110', N'Especialidad 0');
INSERT INTO [dbo].[Docentes] VALUES (111, N'Docente 111', N'Especialidad 1');
INSERT INTO [dbo].[Docentes] VALUES (112, N'Docente 112', N'Especialidad 2');
INSERT INTO [dbo].[Docentes] VALUES (113, N'Docente 113', N'Especialidad 3');
INSERT INTO [dbo].[Docentes] VALUES (114, N'Docente 114', N'Especialidad 4');
INSERT INTO [dbo].[Docentes] VALUES (115, N'Docente 115', N'Especialidad 5');
INSERT INTO [dbo].[Docentes] VALUES (116, N'Docente 116', N'Especialidad 6');
INSERT INTO [dbo].[Docentes] VALUES (117, N'Docente 117', N'Especialidad 7');
INSERT INTO [dbo].[Docentes] VALUES (118, N'Docente 118', N'Especialidad 8');
INSERT INTO [dbo].[Docentes] VALUES (119, N'Docente 119', N'Especialidad 9');
INSERT INTO [dbo].[Docentes] VALUES (120, N'Docente 120', N'Especialidad 0');
INSERT INTO [dbo].[Docentes] VALUES (121, N'Docente 121', N'Especialidad 1');
INSERT INTO [dbo].[Docentes] VALUES (122, N'Docente 122', N'Especialidad 2');
INSERT INTO [dbo].[Docentes] VALUES (123, N'Docente 123', N'Especialidad 3');
INSERT INTO [dbo].[Docentes] VALUES (124, N'Docente 124', N'Especialidad 4');
INSERT INTO [dbo].[Docentes] VALUES (125, N'Docente 125', N'Especialidad 5');
INSERT INTO [dbo].[Docentes] VALUES (126, N'Docente 126', N'Especialidad 6');
INSERT INTO [dbo].[Docentes] VALUES (127, N'Docente 127', N'Especialidad 7');
INSERT INTO [dbo].[Docentes] VALUES (128, N'Docente 128', N'Especialidad 8');
INSERT INTO [dbo].[Docentes] VALUES (129, N'Docente 129', N'Especialidad 9');
INSERT INTO [dbo].[Docentes] VALUES (130, N'Docente 130', N'Especialidad 0');
INSERT INTO [dbo].[Docentes] VALUES (131, N'Docente 131', N'Especialidad 1');
INSERT INTO [dbo].[Docentes] VALUES (132, N'Docente 132', N'Especialidad 2');
INSERT INTO [dbo].[Docentes] VALUES (133, N'Docente 133', N'Especialidad 3');
INSERT INTO [dbo].[Docentes] VALUES (134, N'Docente 134', N'Especialidad 4');
INSERT INTO [dbo].[Docentes] VALUES (135, N'Docente 135', N'Especialidad 5');
INSERT INTO [dbo].[Docentes] VALUES (136, N'Docente 136', N'Especialidad 6');
INSERT INTO [dbo].[Docentes] VALUES (137, N'Docente 137', N'Especialidad 7');
INSERT INTO [dbo].[Docentes] VALUES (138, N'Docente 138', N'Especialidad 8');
INSERT INTO [dbo].[Docentes] VALUES (139, N'Docente 139', N'Especialidad 9');
INSERT INTO [dbo].[Docentes] VALUES (140, N'Docente 140', N'Especialidad 0');
INSERT INTO [dbo].[Docentes] VALUES (141, N'Docente 141', N'Especialidad 1');
INSERT INTO [dbo].[Docentes] VALUES (142, N'Docente 142', N'Especialidad 2');
INSERT INTO [dbo].[Docentes] VALUES (143, N'Docente 143', N'Especialidad 3');
INSERT INTO [dbo].[Docentes] VALUES (144, N'Docente 144', N'Especialidad 4');
INSERT INTO [dbo].[Docentes] VALUES (145, N'Docente 145', N'Especialidad 5');
INSERT INTO [dbo].[Docentes] VALUES (146, N'Docente 146', N'Especialidad 6');
INSERT INTO [dbo].[Docentes] VALUES (147, N'Docente 147', N'Especialidad 7');
INSERT INTO [dbo].[Docentes] VALUES (148, N'Docente 148', N'Especialidad 8');
INSERT INTO [dbo].[Docentes] VALUES (149, N'Docente 149', N'Especialidad 9');
INSERT INTO [dbo].[Docentes] VALUES (150, N'Docente 150', N'Especialidad 0');
INSERT INTO [dbo].[Docentes] VALUES (151, N'Docente 151', N'Especialidad 1');
INSERT INTO [dbo].[Docentes] VALUES (152, N'Docente 152', N'Especialidad 2');
INSERT INTO [dbo].[Docentes] VALUES (153, N'Docente 153', N'Especialidad 3');
INSERT INTO [dbo].[Docentes] VALUES (154, N'Docente 154', N'Especialidad 4');
INSERT INTO [dbo].[Docentes] VALUES (155, N'Docente 155', N'Especialidad 5');
INSERT INTO [dbo].[Docentes] VALUES (156, N'Docente 156', N'Especialidad 6');
INSERT INTO [dbo].[Docentes] VALUES (157, N'Docente 157', N'Especialidad 7');
INSERT INTO [dbo].[Docentes] VALUES (158, N'Docente 158', N'Especialidad 8');
INSERT INTO [dbo].[Docentes] VALUES (159, N'Docente 159', N'Especialidad 9');
INSERT INTO [dbo].[Docentes] VALUES (160, N'Docente 160', N'Especialidad 0');
INSERT INTO [dbo].[Docentes] VALUES (161, N'Docente 161', N'Especialidad 1');
INSERT INTO [dbo].[Docentes] VALUES (162, N'Docente 162', N'Especialidad 2');
INSERT INTO [dbo].[Docentes] VALUES (163, N'Docente 163', N'Especialidad 3');
INSERT INTO [dbo].[Docentes] VALUES (164, N'Docente 164', N'Especialidad 4');
INSERT INTO [dbo].[Docentes] VALUES (165, N'Docente 165', N'Especialidad 5');
INSERT INTO [dbo].[Docentes] VALUES (166, N'Docente 166', N'Especialidad 6');
INSERT INTO [dbo].[Docentes] VALUES (167, N'Docente 167', N'Especialidad 7');
INSERT INTO [dbo].[Docentes] VALUES (168, N'Docente 168', N'Especialidad 8');
INSERT INTO [dbo].[Docentes] VALUES (169, N'Docente 169', N'Especialidad 9');
INSERT INTO [dbo].[Docentes] VALUES (170, N'Docente 170', N'Especialidad 0');
INSERT INTO [dbo].[Docentes] VALUES (171, N'Docente 171', N'Especialidad 1');
INSERT INTO [dbo].[Docentes] VALUES (172, N'Docente 172', N'Especialidad 2');
INSERT INTO [dbo].[Docentes] VALUES (173, N'Docente 173', N'Especialidad 3');
INSERT INTO [dbo].[Docentes] VALUES (174, N'Docente 174', N'Especialidad 4');
INSERT INTO [dbo].[Docentes] VALUES (175, N'Docente 175', N'Especialidad 5');
INSERT INTO [dbo].[Docentes] VALUES (176, N'Docente 176', N'Especialidad 6');
INSERT INTO [dbo].[Docentes] VALUES (177, N'Docente 177', N'Especialidad 7');
INSERT INTO [dbo].[Docentes] VALUES (178, N'Docente 178', N'Especialidad 8');
INSERT INTO [dbo].[Docentes] VALUES (179, N'Docente 179', N'Especialidad 9');
INSERT INTO [dbo].[Docentes] VALUES (180, N'Docente 180', N'Especialidad 0');
INSERT INTO [dbo].[Docentes] VALUES (181, N'Docente 181', N'Especialidad 1');
INSERT INTO [dbo].[Docentes] VALUES (182, N'Docente 182', N'Especialidad 2');
INSERT INTO [dbo].[Docentes] VALUES (183, N'Docente 183', N'Especialidad 3');
INSERT INTO [dbo].[Docentes] VALUES (184, N'Docente 184', N'Especialidad 4');
INSERT INTO [dbo].[Docentes] VALUES (185, N'Docente 185', N'Especialidad 5');
INSERT INTO [dbo].[Docentes] VALUES (186, N'Docente 186', N'Especialidad 6');
INSERT INTO [dbo].[Docentes] VALUES (187, N'Docente 187', N'Especialidad 7');
INSERT INTO [dbo].[Docentes] VALUES (188, N'Docente 188', N'Especialidad 8');
INSERT INTO [dbo].[Docentes] VALUES (189, N'Docente 189', N'Especialidad 9');
INSERT INTO [dbo].[Docentes] VALUES (190, N'Docente 190', N'Especialidad 0');
INSERT INTO [dbo].[Docentes] VALUES (191, N'Docente 191', N'Especialidad 1');
INSERT INTO [dbo].[Docentes] VALUES (192, N'Docente 192', N'Especialidad 2');
INSERT INTO [dbo].[Docentes] VALUES (193, N'Docente 193', N'Especialidad 3');
INSERT INTO [dbo].[Docentes] VALUES (194, N'Docente 194', N'Especialidad 4');
INSERT INTO [dbo].[Docentes] VALUES (195, N'Docente 195', N'Especialidad 5');
INSERT INTO [dbo].[Docentes] VALUES (196, N'Docente 196', N'Especialidad 6');
INSERT INTO [dbo].[Docentes] VALUES (197, N'Docente 197', N'Especialidad 7');
INSERT INTO [dbo].[Docentes] VALUES (198, N'Docente 198', N'Especialidad 8');
INSERT INTO [dbo].[Docentes] VALUES (199, N'Docente 199', N'Especialidad 9');
INSERT INTO [dbo].[Docentes] VALUES (200, N'Docente 200', N'Especialidad 0');
INSERT INTO [dbo].[Docentes] VALUES (201, N'Docente 201', N'Especialidad 1');
INSERT INTO [dbo].[Docentes] VALUES (202, N'Docente 202', N'Especialidad 2');
INSERT INTO [dbo].[Docentes] VALUES (203, N'Docente 203', N'Especialidad 3');
INSERT INTO [dbo].[Docentes] VALUES (204, N'Docente 204', N'Especialidad 4');
INSERT INTO [dbo].[Docentes] VALUES (205, N'Docente 205', N'Especialidad 5');
INSERT INTO [dbo].[Docentes] VALUES (206, N'Docente 206', N'Especialidad 6');
INSERT INTO [dbo].[Docentes] VALUES (207, N'Docente 207', N'Especialidad 7');
INSERT INTO [dbo].[Docentes] VALUES (208, N'Docente 208', N'Especialidad 8');
INSERT INTO [dbo].[Docentes] VALUES (209, N'Docente 209', N'Especialidad 9');
INSERT INTO [dbo].[Docentes] VALUES (210, N'Docente 210', N'Especialidad 0');
INSERT INTO [dbo].[Docentes] VALUES (211, N'Docente 211', N'Especialidad 1');
INSERT INTO [dbo].[Docentes] VALUES (212, N'Docente 212', N'Especialidad 2');
INSERT INTO [dbo].[Docentes] VALUES (213, N'Docente 213', N'Especialidad 3');
INSERT INTO [dbo].[Docentes] VALUES (214, N'Docente 214', N'Especialidad 4');
INSERT INTO [dbo].[Docentes] VALUES (215, N'Docente 215', N'Especialidad 5');
INSERT INTO [dbo].[Docentes] VALUES (216, N'Docente 216', N'Especialidad 6');
INSERT INTO [dbo].[Docentes] VALUES (217, N'Docente 217', N'Especialidad 7');
INSERT INTO [dbo].[Docentes] VALUES (218, N'Docente 218', N'Especialidad 8');
INSERT INTO [dbo].[Docentes] VALUES (219, N'Docente 219', N'Especialidad 9');
INSERT INTO [dbo].[Docentes] VALUES (220, N'Docente 220', N'Especialidad 0');
INSERT INTO [dbo].[Docentes] VALUES (221, N'Docente 221', N'Especialidad 1');
INSERT INTO [dbo].[Docentes] VALUES (222, N'Docente 222', N'Especialidad 2');
INSERT INTO [dbo].[Docentes] VALUES (223, N'Docente 223', N'Especialidad 3');
INSERT INTO [dbo].[Docentes] VALUES (224, N'Docente 224', N'Especialidad 4');
INSERT INTO [dbo].[Docentes] VALUES (225, N'Docente 225', N'Especialidad 5');
INSERT INTO [dbo].[Docentes] VALUES (226, N'Docente 226', N'Especialidad 6');
INSERT INTO [dbo].[Docentes] VALUES (227, N'Docente 227', N'Especialidad 7');
INSERT INTO [dbo].[Docentes] VALUES (228, N'Docente 228', N'Especialidad 8');
INSERT INTO [dbo].[Docentes] VALUES (229, N'Docente 229', N'Especialidad 9');
INSERT INTO [dbo].[Docentes] VALUES (230, N'Docente 230', N'Especialidad 0');
INSERT INTO [dbo].[Docentes] VALUES (231, N'Docente 231', N'Especialidad 1');
INSERT INTO [dbo].[Docentes] VALUES (232, N'Docente 232', N'Especialidad 2');
INSERT INTO [dbo].[Docentes] VALUES (233, N'Docente 233', N'Especialidad 3');
INSERT INTO [dbo].[Docentes] VALUES (234, N'Docente 234', N'Especialidad 4');
INSERT INTO [dbo].[Docentes] VALUES (235, N'Docente 235', N'Especialidad 5');
INSERT INTO [dbo].[Docentes] VALUES (236, N'Docente 236', N'Especialidad 6');
INSERT INTO [dbo].[Docentes] VALUES (237, N'Docente 237', N'Especialidad 7');
INSERT INTO [dbo].[Docentes] VALUES (238, N'Docente 238', N'Especialidad 8');
INSERT INTO [dbo].[Docentes] VALUES (239, N'Docente 239', N'Especialidad 9');
INSERT INTO [dbo].[Docentes] VALUES (240, N'Docente 240', N'Especialidad 0');
INSERT INTO [dbo].[Docentes] VALUES (241, N'Docente 241', N'Especialidad 1');
INSERT INTO [dbo].[Docentes] VALUES (242, N'Docente 242', N'Especialidad 2');
INSERT INTO [dbo].[Docentes] VALUES (243, N'Docente 243', N'Especialidad 3');
INSERT INTO [dbo].[Docentes] VALUES (244, N'Docente 244', N'Especialidad 4');
INSERT INTO [dbo].[Docentes] VALUES (245, N'Docente 245', N'Especialidad 5');
INSERT INTO [dbo].[Docentes] VALUES (246, N'Docente 246', N'Especialidad 6');
INSERT INTO [dbo].[Docentes] VALUES (247, N'Docente 247', N'Especialidad 7');
INSERT INTO [dbo].[Docentes] VALUES (248, N'Docente 248', N'Especialidad 8');
INSERT INTO [dbo].[Docentes] VALUES (249, N'Docente 249', N'Especialidad 9');
INSERT INTO [dbo].[Docentes] VALUES (250, N'Docente 250', N'Especialidad 0');
INSERT INTO [dbo].[Docentes] VALUES (251, N'Docente 251', N'Especialidad 1');
INSERT INTO [dbo].[Docentes] VALUES (252, N'Docente 252', N'Especialidad 2');
INSERT INTO [dbo].[Docentes] VALUES (253, N'Docente 253', N'Especialidad 3');
INSERT INTO [dbo].[Docentes] VALUES (254, N'Docente 254', N'Especialidad 4');
INSERT INTO [dbo].[Docentes] VALUES (255, N'Docente 255', N'Especialidad 5');
INSERT INTO [dbo].[Docentes] VALUES (256, N'Docente 256', N'Especialidad 6');
INSERT INTO [dbo].[Docentes] VALUES (257, N'Docente 257', N'Especialidad 7');
INSERT INTO [dbo].[Docentes] VALUES (258, N'Docente 258', N'Especialidad 8');
INSERT INTO [dbo].[Docentes] VALUES (259, N'Docente 259', N'Especialidad 9');
INSERT INTO [dbo].[Docentes] VALUES (260, N'Docente 260', N'Especialidad 0');
INSERT INTO [dbo].[Docentes] VALUES (261, N'Docente 261', N'Especialidad 1');
INSERT INTO [dbo].[Docentes] VALUES (262, N'Docente 262', N'Especialidad 2');
INSERT INTO [dbo].[Docentes] VALUES (263, N'Docente 263', N'Especialidad 3');
INSERT INTO [dbo].[Docentes] VALUES (264, N'Docente 264', N'Especialidad 4');
INSERT INTO [dbo].[Docentes] VALUES (265, N'Docente 265', N'Especialidad 5');
INSERT INTO [dbo].[Docentes] VALUES (266, N'Docente 266', N'Especialidad 6');
INSERT INTO [dbo].[Docentes] VALUES (267, N'Docente 267', N'Especialidad 7');
INSERT INTO [dbo].[Docentes] VALUES (268, N'Docente 268', N'Especialidad 8');
INSERT INTO [dbo].[Docentes] VALUES (269, N'Docente 269', N'Especialidad 9');
INSERT INTO [dbo].[Docentes] VALUES (270, N'Docente 270', N'Especialidad 0');
INSERT INTO [dbo].[Docentes] VALUES (271, N'Docente 271', N'Especialidad 1');
INSERT INTO [dbo].[Docentes] VALUES (272, N'Docente 272', N'Especialidad 2');
INSERT INTO [dbo].[Docentes] VALUES (273, N'Docente 273', N'Especialidad 3');
INSERT INTO [dbo].[Docentes] VALUES (274, N'Docente 274', N'Especialidad 4');
INSERT INTO [dbo].[Docentes] VALUES (275, N'Docente 275', N'Especialidad 5');
INSERT INTO [dbo].[Docentes] VALUES (276, N'Docente 276', N'Especialidad 6');
INSERT INTO [dbo].[Docentes] VALUES (277, N'Docente 277', N'Especialidad 7');
INSERT INTO [dbo].[Docentes] VALUES (278, N'Docente 278', N'Especialidad 8');
INSERT INTO [dbo].[Docentes] VALUES (279, N'Docente 279', N'Especialidad 9');
INSERT INTO [dbo].[Docentes] VALUES (280, N'Docente 280', N'Especialidad 0');
INSERT INTO [dbo].[Docentes] VALUES (281, N'Docente 281', N'Especialidad 1');
INSERT INTO [dbo].[Docentes] VALUES (282, N'Docente 282', N'Especialidad 2');
INSERT INTO [dbo].[Docentes] VALUES (283, N'Docente 283', N'Especialidad 3');
INSERT INTO [dbo].[Docentes] VALUES (284, N'Docente 284', N'Especialidad 4');
INSERT INTO [dbo].[Docentes] VALUES (285, N'Docente 285', N'Especialidad 5');
INSERT INTO [dbo].[Docentes] VALUES (286, N'Docente 286', N'Especialidad 6');
INSERT INTO [dbo].[Docentes] VALUES (287, N'Docente 287', N'Especialidad 7');
INSERT INTO [dbo].[Docentes] VALUES (288, N'Docente 288', N'Especialidad 8');
INSERT INTO [dbo].[Docentes] VALUES (289, N'Docente 289', N'Especialidad 9');
INSERT INTO [dbo].[Docentes] VALUES (290, N'Docente 290', N'Especialidad 0');
INSERT INTO [dbo].[Docentes] VALUES (291, N'Docente 291', N'Especialidad 1');
INSERT INTO [dbo].[Docentes] VALUES (292, N'Docente 292', N'Especialidad 2');
INSERT INTO [dbo].[Docentes] VALUES (293, N'Docente 293', N'Especialidad 3');
INSERT INTO [dbo].[Docentes] VALUES (294, N'Docente 294', N'Especialidad 4');
INSERT INTO [dbo].[Docentes] VALUES (295, N'Docente 295', N'Especialidad 5');
INSERT INTO [dbo].[Docentes] VALUES (296, N'Docente 296', N'Especialidad 6');
INSERT INTO [dbo].[Docentes] VALUES (297, N'Docente 297', N'Especialidad 7');
INSERT INTO [dbo].[Docentes] VALUES (298, N'Docente 298', N'Especialidad 8');
INSERT INTO [dbo].[Docentes] VALUES (299, N'Docente 299', N'Especialidad 9');
INSERT INTO [dbo].[Docentes] VALUES (300, N'Docente 300', N'Especialidad 0');
