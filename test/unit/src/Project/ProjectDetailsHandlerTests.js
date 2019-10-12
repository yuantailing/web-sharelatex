const SandboxedModule = require('sandboxed-module')
const sinon = require('sinon')
const { expect } = require('chai')
const { ObjectId } = require('mongodb')
const Errors = require('../../../../app/src/Features/Errors/Errors')
const PrivilegeLevels = require('../../../../app/src/Features/Authorization/PrivilegeLevels')

const MODULE_PATH = '../../../../app/src/Features/Project/ProjectDetailsHandler'

describe('ProjectDetailsHandler', function() {
  beforeEach(function() {
    this.user = {
      _id: ObjectId('abcdefabcdefabcdefabcdef'),
      features: 'mock-features'
    }
    this.collaborator = {
      _id: ObjectId('123456123456123456123456')
    }
    this.project = {
      _id: ObjectId('5d5dabdbb351de090cdff0b2'),
      name: 'project',
      description: 'this is a great project',
      something: 'should not exist',
      compiler: 'latexxxxxx',
      owner_ref: this.user._id,
      collaberator_refs: [this.collaborator._id]
    }
    this.ProjectGetter = {
      promises: {
        getProjectWithoutDocLines: sinon.stub().resolves(this.project),
        getProject: sinon.stub().resolves(this.project),
        findAllUsersProjects: sinon.stub().resolves({
          owned: [],
          readAndWrite: [],
          readOnly: [],
          tokenReadAndWrite: [],
          tokenReadOnly: []
        })
      }
    }
    this.ProjectModel = {
      update: sinon.stub().returns({
        exec: sinon.stub().resolves()
      })
    }
    this.UserGetter = {
      promises: {
        getUser: sinon.stub().resolves(this.user)
      }
    }
    this.TpdsUpdateSender = {
      promises: {
        moveEntity: sinon.stub().resolves()
      }
    }
    this.ProjectEntityHandler = {
      promises: {
        flushProjectToThirdPartyDataStore: sinon.stub().resolves()
      }
    }
    this.CollaboratorsHandler = {
      promises: {
        removeUserFromProject: sinon.stub().resolves(),
        addUserIdToProject: sinon.stub().resolves()
      }
    }
    this.ProjectTokenGenerator = {
      readAndWriteToken: sinon.stub(),
      promises: {
        generateUniqueReadOnlyToken: sinon.stub()
      }
    }
    this.settings = {
      defaultFeatures: 'default-features'
    }
    this.handler = SandboxedModule.require(MODULE_PATH, {
      globals: {
        console: console
      },
      requires: {
        './ProjectGetter': this.ProjectGetter,
        '../../models/Project': {
          Project: this.ProjectModel
        },
        '../User/UserGetter': this.UserGetter,
        '../ThirdPartyDataStore/TpdsUpdateSender': this.TpdsUpdateSender,
        './ProjectEntityHandler': this.ProjectEntityHandler,
        '../Collaborators/CollaboratorsHandler': this.CollaboratorsHandler,
        'logger-sharelatex': {
          log() {},
          warn() {},
          err() {}
        },
        './ProjectTokenGenerator': this.ProjectTokenGenerator,
        '../Errors/Errors': Errors,
        'settings-sharelatex': this.settings
      }
    })
  })

  describe('getDetails', function() {
    it('should find the project and owner', async function() {
      const details = await this.handler.promises.getDetails(this.project._id)
      details.name.should.equal(this.project.name)
      details.description.should.equal(this.project.description)
      details.compiler.should.equal(this.project.compiler)
      details.features.should.equal(this.user.features)
      expect(details.something).to.be.undefined
    })

    it('should find overleaf metadata if it exists', async function() {
      this.project.overleaf = { id: 'id' }
      const details = await this.handler.promises.getDetails(this.project._id)
      details.overleaf.should.equal(this.project.overleaf)
      expect(details.something).to.be.undefined
    })

    it('should return an error for a non-existent project', async function() {
      this.ProjectGetter.promises.getProject.resolves(null)
      await expect(
        this.handler.promises.getDetails('0123456789012345678901234')
      ).to.be.rejectedWith(Errors.NotFoundError)
    })

    it('should return the default features if no owner found', async function() {
      this.UserGetter.promises.getUser.resolves(null)
      const details = await this.handler.promises.getDetails(this.project._id)
      details.features.should.equal(this.settings.defaultFeatures)
    })

    it('should rethrow any error', async function() {
      this.ProjectGetter.promises.getProject.rejects(new Error('boom'))
      await expect(this.handler.promises.getDetails(this.project._id)).to.be
        .rejected
    })
  })

  describe('transferOwnership', function() {
    beforeEach(function() {
      this.UserGetter.promises.getUser.resolves(this.collaborator)
    })

    it("should return a not found error if the project can't be found", async function() {
      this.ProjectGetter.promises.getProject.resolves(null)
      await expect(
        this.handler.promises.transferOwnership('abc', this.collaborator._id)
      ).to.be.rejectedWith(Errors.ProjectNotFoundError)
    })

    it("should return a not found error if the user can't be found", async function() {
      this.UserGetter.promises.getUser.resolves(null)
      await expect(
        this.handler.promises.transferOwnership(
          this.project._id,
          this.collaborator._id
        )
      ).to.be.rejectedWith(Errors.UserNotFoundError)
    })

    it('should return an error if user cannot be removed as collaborator ', async function() {
      this.CollaboratorsHandler.promises.removeUserFromProject.rejects(
        new Error('user-cannot-be-removed')
      )
      await expect(
        this.handler.promises.transferOwnership(
          this.project._id,
          this.collaborator._id
        )
      ).to.be.rejected
    })

    it('should transfer ownership of the project', async function() {
      await this.handler.promises.transferOwnership(
        this.project._id,
        this.collaborator._id
      )
      expect(this.ProjectModel.update).to.have.been.calledWith(
        { _id: this.project._id },
        sinon.match({ $set: { owner_ref: this.collaborator._id } })
      )
    })

    it('should do nothing if transferring back to the owner', async function() {
      await this.handler.promises.transferOwnership(
        this.project._id,
        this.user._id
      )
      expect(this.ProjectModel.update).not.to.have.been.called
    })

    it("should remove the user from the project's collaborators", async function() {
      await this.handler.promises.transferOwnership(
        this.project._id,
        this.collaborator._id
      )
      expect(
        this.CollaboratorsHandler.promises.removeUserFromProject
      ).to.have.been.calledWith(this.project._id, this.collaborator._id)
    })

    it('should add the former project owner as a read/write collaborator', async function() {
      await this.handler.promises.transferOwnership(
        this.project._id,
        this.collaborator._id
      )
      expect(
        this.CollaboratorsHandler.promises.addUserIdToProject
      ).to.have.been.calledWith(
        this.project._id,
        this.collaborator._id,
        this.user._id,
        PrivilegeLevels.READ_AND_WRITE
      )
    })

    it('should flush the project to tpds', async function() {
      await this.handler.promises.transferOwnership(
        this.project._id,
        this.collaborator._id
      )
      expect(
        this.ProjectEntityHandler.promises.flushProjectToThirdPartyDataStore
      ).to.have.been.calledWith(this.project._id)
    })

    it('should decline to transfer ownership to a non-collaborator', async function() {
      this.project.collaberator_refs = []
      await expect(
        this.handler.promises.transferOwnership(
          this.project._id,
          this.collaborator._id
        )
      ).to.be.rejectedWith(Errors.UserNotCollaboratorError)
    })
  })

  describe('getProjectDescription', function() {
    it('should make a call to mongo just for the description', async function() {
      this.ProjectGetter.promises.getProject.resolves()
      await this.handler.promises.getProjectDescription(this.project._id)
      expect(this.ProjectGetter.promises.getProject).to.have.been.calledWith(
        this.project._id,
        { description: true }
      )
    })

    it('should return what the mongo call returns', async function() {
      const expectedDescription = 'cool project'
      this.ProjectGetter.promises.getProject.resolves({
        description: expectedDescription
      })
      const description = await this.handler.promises.getProjectDescription(
        this.project._id
      )
      expect(description).to.equal(expectedDescription)
    })
  })

  describe('setProjectDescription', function() {
    beforeEach(function() {
      this.description = 'updated teh description'
    })

    it('should update the project detials', async function() {
      await this.handler.promises.setProjectDescription(
        this.project._id,
        this.description
      )
      expect(this.ProjectModel.update).to.have.been.calledWith(
        { _id: this.project._id },
        { description: this.description }
      )
    })
  })

  describe('renameProject', function() {
    beforeEach(function() {
      this.newName = 'new name here'
    })

    it('should update the project with the new name', async function() {
      await this.handler.promises.renameProject(this.project._id, this.newName)
      expect(this.ProjectModel.update).to.have.been.calledWith(
        { _id: this.project._id },
        { name: this.newName }
      )
    })

    it('should tell the TpdsUpdateSender', async function() {
      await this.handler.promises.renameProject(this.project._id, this.newName)
      expect(this.TpdsUpdateSender.promises.moveEntity).to.have.been.calledWith(
        {
          project_id: this.project._id,
          project_name: this.project.name,
          newProjectName: this.newName
        }
      )
    })

    it('should not do anything with an invalid name', async function() {
      await expect(this.handler.promises.renameProject(this.project._id)).to.be
        .rejected
      expect(this.TpdsUpdateSender.promises.moveEntity).not.to.have.been.called
      expect(this.ProjectModel.update).not.to.have.been.called
    })
  })

  describe('validateProjectName', function() {
    it('should reject undefined names', async function() {
      await expect(this.handler.promises.validateProjectName(undefined)).to.be
        .rejected
    })

    it('should reject empty names', async function() {
      await expect(this.handler.promises.validateProjectName('')).to.be.rejected
    })

    it('should reject names with /s', async function() {
      await expect(this.handler.promises.validateProjectName('foo/bar')).to.be
        .rejected
    })

    it('should reject names with \\s', async function() {
      await expect(this.handler.promises.validateProjectName('foo\\bar')).to.be
        .rejected
    })

    it('should reject long names', async function() {
      await expect(this.handler.promises.validateProjectName('a'.repeat(1000)))
        .to.be.rejected
    })

    it('should accept normal names', async function() {
      await expect(this.handler.promises.validateProjectName('foobar')).to.be
        .resolved
    })
  })

  describe('generateUniqueName', function() {
    beforeEach(function() {
      this.longName = 'x'.repeat(this.handler.MAX_PROJECT_NAME_LENGTH - 5)
      const usersProjects = {
        owned: [
          { _id: 1, name: 'name' },
          { _id: 2, name: 'name1' },
          { _id: 3, name: 'name11' },
          { _id: 100, name: 'numeric' },
          { _id: 101, name: 'numeric (1)' },
          { _id: 102, name: 'numeric (2)' },
          { _id: 103, name: 'numeric (3)' },
          { _id: 104, name: 'numeric (4)' },
          { _id: 105, name: 'numeric (5)' },
          { _id: 106, name: 'numeric (6)' },
          { _id: 107, name: 'numeric (7)' },
          { _id: 108, name: 'numeric (8)' },
          { _id: 109, name: 'numeric (9)' },
          { _id: 110, name: 'numeric (10)' },
          { _id: 111, name: 'numeric (11)' },
          { _id: 112, name: 'numeric (12)' },
          { _id: 113, name: 'numeric (13)' },
          { _id: 114, name: 'numeric (14)' },
          { _id: 115, name: 'numeric (15)' },
          { _id: 116, name: 'numeric (16)' },
          { _id: 117, name: 'numeric (17)' },
          { _id: 118, name: 'numeric (18)' },
          { _id: 119, name: 'numeric (19)' },
          { _id: 120, name: 'numeric (20)' },
          { _id: 130, name: 'numeric (30)' },
          { _id: 131, name: 'numeric (31)' },
          { _id: 132, name: 'numeric (32)' },
          { _id: 133, name: 'numeric (33)' },
          { _id: 134, name: 'numeric (34)' },
          { _id: 135, name: 'numeric (35)' },
          { _id: 136, name: 'numeric (36)' },
          { _id: 137, name: 'numeric (37)' },
          { _id: 138, name: 'numeric (38)' },
          { _id: 139, name: 'numeric (39)' },
          { _id: 140, name: 'numeric (40)' }
        ],
        readAndWrite: [{ _id: 4, name: 'name2' }, { _id: 5, name: 'name22' }],
        readOnly: [{ _id: 6, name: 'name3' }, { _id: 7, name: 'name33' }],
        tokenReadAndWrite: [
          { _id: 8, name: 'name4' },
          { _id: 9, name: 'name44' }
        ],
        tokenReadOnly: [
          { _id: 10, name: 'name5' },
          { _id: 11, name: 'name55' },
          { _id: 12, name: this.longName }
        ]
      }
      this.ProjectGetter.promises.findAllUsersProjects.resolves(usersProjects)
    })

    it('should leave a unique name unchanged', async function() {
      const name = await this.handler.promises.generateUniqueName(
        this.user._id,
        'unique-name',
        ['-test-suffix']
      )
      expect(name).to.equal('unique-name')
    })

    it('should append a suffix to an existing name', async function() {
      const name = await this.handler.promises.generateUniqueName(
        this.user._id,
        'name1',
        ['-test-suffix']
      )
      expect(name).to.equal('name1-test-suffix')
    })

    it('should fallback to a second suffix when needed', async function() {
      const name = await this.handler.promises.generateUniqueName(
        this.user._id,
        'name1',
        ['1', '-test-suffix']
      )
      expect(name).to.equal('name1-test-suffix')
    })

    it('should truncate the name when append a suffix if the result is too long', async function() {
      const name = await this.handler.promises.generateUniqueName(
        this.user._id,
        this.longName,
        ['-test-suffix']
      )
      expect(name).to.equal(
        this.longName.substr(0, this.handler.MAX_PROJECT_NAME_LENGTH - 12) +
          '-test-suffix'
      )
    })

    it('should use a numeric index if no suffix is supplied', async function() {
      const name = await this.handler.promises.generateUniqueName(
        this.user._id,
        'name1',
        []
      )
      expect(name).to.equal('name1 (1)')
    })

    it('should use a numeric index if all suffixes are exhausted', async function() {
      const name = await this.handler.promises.generateUniqueName(
        this.user._id,
        'name',
        ['1', '11']
      )
      expect(name).to.equal('name (1)')
    })

    it('should find the next lowest available numeric index for the base name', async function() {
      const name = await this.handler.promises.generateUniqueName(
        this.user._id,
        'numeric',
        []
      )
      expect(name).to.equal('numeric (21)')
    })

    it('should find the next available numeric index when a numeric index is already present', async function() {
      const name = await this.handler.promises.generateUniqueName(
        this.user._id,
        'numeric (5)',
        []
      )
      expect(name).to.equal('numeric (21)')
    })

    it('should not find a numeric index lower than the one already present', async function() {
      const name = await this.handler.promises.generateUniqueName(
        this.user._id,
        'numeric (31)',
        []
      )
      expect(name).to.equal('numeric (41)')
    })
  })

  describe('fixProjectName', function() {
    it('should change empty names to Untitled', function() {
      expect(this.handler.fixProjectName('')).to.equal('Untitled')
    })

    it('should replace / with -', function() {
      expect(this.handler.fixProjectName('foo/bar')).to.equal('foo-bar')
    })

    it("should replace \\ with ''", function() {
      expect(this.handler.fixProjectName('foo \\ bar')).to.equal('foo  bar')
    })

    it('should truncate long names', function() {
      expect(this.handler.fixProjectName('a'.repeat(1000))).to.equal(
        'a'.repeat(150)
      )
    })

    it('should accept normal names', function() {
      expect(this.handler.fixProjectName('foobar')).to.equal('foobar')
    })
  })

  describe('setPublicAccessLevel', function() {
    beforeEach(function() {
      this.accessLevel = 'readOnly'
    })

    it('should update the project with the new level', async function() {
      await this.handler.promises.setPublicAccessLevel(
        this.project._id,
        this.accessLevel
      )
      expect(this.ProjectModel.update).to.have.been.calledWith(
        { _id: this.project._id },
        { publicAccesLevel: this.accessLevel }
      )
    })

    it('should not produce an error', async function() {
      await expect(
        this.handler.promises.setPublicAccessLevel(
          this.project._id,
          this.accessLevel
        )
      ).to.be.resolved
    })

    describe('when update produces an error', function() {
      beforeEach(function() {
        this.ProjectModel.update.rejects(new Error('woops'))
      })

      it('should produce an error', async function() {
        await expect(
          this.handler.promises.setPublicAccessLevel(
            this.project._id,
            this.accessLevel
          )
        ).to.be.rejected
      })
    })
  })

  describe('ensureTokensArePresent', function() {
    describe('when the project has tokens', function() {
      beforeEach(function() {
        this.project = {
          _id: this.project._id,
          tokens: {
            readOnly: 'aaa',
            readAndWrite: '42bbb',
            readAndWritePrefix: '42'
          }
        }
        this.ProjectGetter.promises.getProject.resolves(this.project)
      })

      it('should get the project', async function() {
        await this.handler.promises.ensureTokensArePresent(this.project._id)
        expect(this.ProjectGetter.promises.getProject).to.have.been.calledOnce
        expect(this.ProjectGetter.promises.getProject).to.have.been.calledWith(
          this.project._id,
          {
            tokens: 1
          }
        )
      })

      it('should not update the project with new tokens', async function() {
        await this.handler.promises.ensureTokensArePresent(this.project._id)
        expect(this.ProjectModel.update).not.to.have.been.called
      })

      it('should produce the tokens without error', async function() {
        const tokens = await this.handler.promises.ensureTokensArePresent(
          this.project._id
        )
        expect(tokens).to.deep.equal(this.project.tokens)
      })
    })

    describe('when tokens are missing', function() {
      beforeEach(function() {
        this.project = { _id: this.project._id }
        this.ProjectGetter.promises.getProject.resolves(this.project)
        this.readOnlyToken = 'abc'
        this.readAndWriteToken = '42def'
        this.readAndWriteTokenPrefix = '42'
        this.ProjectTokenGenerator.promises.generateUniqueReadOnlyToken.resolves(
          this.readOnlyToken
        )
        this.ProjectTokenGenerator.readAndWriteToken.returns({
          token: this.readAndWriteToken,
          numericPrefix: this.readAndWriteTokenPrefix
        })
      })

      it('should get the project', async function() {
        await this.handler.promises.ensureTokensArePresent(this.project._id)
        expect(this.ProjectGetter.promises.getProject).to.have.been.calledOnce
        expect(this.ProjectGetter.promises.getProject).to.have.been.calledWith(
          this.project._id,
          {
            tokens: 1
          }
        )
      })

      it('should update the project with new tokens', async function() {
        await this.handler.promises.ensureTokensArePresent(this.project._id)
        expect(this.ProjectTokenGenerator.promises.generateUniqueReadOnlyToken)
          .to.have.been.calledOnce
        expect(this.ProjectTokenGenerator.readAndWriteToken).to.have.been
          .calledOnce
        expect(this.ProjectModel.update).to.have.been.calledOnce
        expect(this.ProjectModel.update).to.have.been.calledWith(
          { _id: this.project._id },
          {
            $set: {
              tokens: {
                readOnly: this.readOnlyToken,
                readAndWrite: this.readAndWriteToken,
                readAndWritePrefix: this.readAndWriteTokenPrefix
              }
            }
          }
        )
      })

      it('should produce the tokens without error', async function() {
        const tokens = await this.handler.promises.ensureTokensArePresent(
          this.project._id
        )
        expect(tokens).to.deep.equal({
          readOnly: this.readOnlyToken,
          readAndWrite: this.readAndWriteToken,
          readAndWritePrefix: this.readAndWriteTokenPrefix
        })
      })
    })
  })
})
