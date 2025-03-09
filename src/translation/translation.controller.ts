import { Cache, CACHE_MANAGER } from '@nestjs/cache-manager'
import { Body, Controller, Get, Inject, Logger, Post, Query, Req } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { IsString, MaxLength, MinLength } from 'class-validator'
import * as dayjs from 'dayjs'
import { Request } from 'express'
import { CACHE_KEYS } from 'src/cache/cache.constants'
import { EnvironmentVariables } from 'src/env'
import { RoutesService } from 'src/routes/routes.service'

class CreateTranslationDto {
  @IsString()
  @MinLength(5)
  @MaxLength(80)
  name: string
}

@Controller('translation')
export class TranslationController {
  constructor(
    private readonly routeService: RoutesService,
    private readonly configService: ConfigService<EnvironmentVariables>,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache
  ) {}

  @Get('/list')
  async getAllTranslations(@Req() req: Request) {
    const repositoryOwner = this.configService.getOrThrow('REPOSITORY_OWNER', { infer: true })
    const repositoryName = this.configService.getOrThrow('REPOSITORY_NAME', { infer: true })
    const mainBranch = this.configService.getOrThrow('REPOSITORY_MAIN_BRANCH', { infer: true })

    const response = await fetch(
      this.routeService.GITHUB_ROUTES.LIST_PULL_REQUESTS(repositoryOwner, repositoryName) +
        `?base=${mainBranch}&state=all`,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(req.headers.authorization ? { Authorization: req.headers.authorization } : {})
        }
      }
    )

    if (!response.ok) throw new Error(`Failed to fetch data ${response.status} ${response.statusText}`)
    return (await response.json()) as unknown
  }

  @Post('/')
  async createTranslation(@Req() req: Request, @Body() body: CreateTranslationDto) {
    const repositoryOwner = this.configService.getOrThrow('REPOSITORY_OWNER', { infer: true })
    const repositoryName = this.configService.getOrThrow('REPOSITORY_NAME', { infer: true })
    const mainBranch = this.configService.getOrThrow('REPOSITORY_MAIN_BRANCH', { infer: true })
    const translationLabel = this.configService.getOrThrow('TRANSLATION_LABEL_NAME', { infer: true })
    const wipLabel = this.configService.getOrThrow('TRANSLATION_WIP_LABEL_NAME', { infer: true })

    const lastMasterCommitResponse = await fetch(
      this.routeService.GITHUB_ROUTES.COMMITS(repositoryOwner, repositoryName, mainBranch),
      {
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(req.headers.authorization ? { Authorization: req.headers.authorization } : {})
        }
      }
    )

    if (!lastMasterCommitResponse.ok)
      throw new Error(
        `Failed to retrieve last commit ${lastMasterCommitResponse.status} ${lastMasterCommitResponse.statusText}`
      )

    const lastMasterCommit = (await lastMasterCommitResponse.json()) as { sha: string }

    const now = dayjs()

    const head = now.format('YYYY-MM-DD-HH-mm-ss-SSS')
    const ref = `refs/heads/${head}`

    const refCreationResponse = await fetch(
      this.routeService.GITHUB_ROUTES.CREATE_REF(repositoryOwner, repositoryName),
      {
        method: 'POST',
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(req.headers.authorization ? { Authorization: req.headers.authorization } : {})
        },
        body: JSON.stringify({ ref, sha: lastMasterCommit.sha })
      }
    )

    if (!refCreationResponse.ok)
      throw new Error(
        `Failed to create branch ${refCreationResponse.status} ${refCreationResponse.statusText} ${await refCreationResponse.text()}`
      )

    const branchIdentifierContentsResponse = await fetch(
      this.routeService.GITHUB_ROUTES.READ_FILE(repositoryOwner, repositoryName, '.branch-identifier') + `?ref=${head}`,
      {
        headers: {
          Accept: 'application/vnd.github.v3+json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(req.headers.authorization ? { Authorization: req.headers.authorization } : {})
        }
      }
    )

    if (!branchIdentifierContentsResponse.ok)
      throw new Error(
        `Failed to read branch identifier ${branchIdentifierContentsResponse.status} ${branchIdentifierContentsResponse.statusText} ${await branchIdentifierContentsResponse.text()}`
      )

    const branchIdentifierContents = (await branchIdentifierContentsResponse.json()) as { sha: string }

    // Edit readme.md to add the branch name at the end
    const editionReponse = await fetch(
      this.routeService.GITHUB_ROUTES.EDIT_FILE(repositoryOwner, repositoryName, '.branch-identifier'),
      {
        method: 'PUT',
        headers: {
          Accept: 'application/vnd.github.v3+json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(req.headers.authorization ? { Authorization: req.headers.authorization } : {})
        },
        body: JSON.stringify({
          message: `Branch identifier for ${head}`,
          content: Buffer.from(head).toString('base64'),
          branch: head,
          sha: branchIdentifierContents.sha
        })
      }
    )

    if (!editionReponse.ok)
      throw new Error(
        `Failed to edit branch identifier ${editionReponse.status} ${editionReponse.statusText} ${await editionReponse.text()}`
      )

    const pullRequestCreationResponse = await fetch(
      this.routeService.GITHUB_ROUTES.CREATE_PULL_REQUEST(repositoryOwner, repositoryName),
      {
        method: 'POST',
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(req.headers.authorization ? { Authorization: req.headers.authorization } : {})
        },
        body: JSON.stringify({ title: body.name, head, base: mainBranch })
      }
    )

    if (!pullRequestCreationResponse.ok)
      throw new Error(
        `Failed to create PR ${pullRequestCreationResponse.status} ${pullRequestCreationResponse.statusText} ${await pullRequestCreationResponse.text()}`
      )

    const pullRequest = (await pullRequestCreationResponse.json()) as { number: number }

    const addLabelResponse = await fetch(
      this.routeService.GITHUB_ROUTES.ADD_LABEL(repositoryOwner, repositoryName, pullRequest.number),
      {
        method: 'POST',
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(req.headers.authorization ? { Authorization: req.headers.authorization } : {})
        },
        body: JSON.stringify([translationLabel, wipLabel])
      }
    )

    if (!addLabelResponse.ok)
      throw new Error(
        `Failed to add label to PR ${addLabelResponse.status} ${addLabelResponse.statusText} ${await addLabelResponse.text()}`
      )

    return pullRequest
  }

  @Get('/files')
  public async getFiles(@Req() req: Request, @Query('branch') branch: string) {
    const cachedFiles = await this.cacheManager.get(CACHE_KEYS.FILES(branch))
    if (cachedFiles) {
      Logger.log(`Returning cached files for branch ${branch}`)
      return cachedFiles
    }

    const repositoryOwner = this.configService.getOrThrow('REPOSITORY_OWNER', { infer: true })
    const repositoryName = this.configService.getOrThrow('REPOSITORY_NAME', { infer: true })

    const filePaths = [
      {
        original: 'chapitre-0/strings_en.txt',
        translated: 'chapitre-0/strings_fr.txt',
        name: 'Strings du chapitre 0',
        category: 'Chapitre 0'
      },
      {
        original: 'chapitre-1/lang_en.json',
        translated: 'chapitre-1/lang_fr.json',
        name: 'Dialogues du chapitre 1',
        category: 'Chapitre 1'
      },
      {
        original: 'chapitre-1/strings_en.txt',
        translated: 'chapitre-1/strings_fr.txt',
        name: 'Strings du chapitre 1',
        category: 'Chapitre 1'
      },
      {
        original: 'chapitre-2/strings_en.txt',
        translated: 'chapitre-2/strings_fr.txt',
        name: 'Strings du chapitre 2',
        category: 'Chapitre 2'
      }
    ]

    const files = await Promise.all(
      filePaths.map(async ({ original, translated, name, category }) => {
        const originalFileResponse = await fetch(
          this.routeService.GITHUB_ROUTES.READ_FILE(repositoryOwner, repositoryName, original) + `?ref=${branch}`,
          {
            headers: {
              Accept: 'application/vnd.github.v3+json',
              'X-GitHub-Api-Version': '2022-11-28',
              ...(req.headers.authorization ? { Authorization: req.headers.authorization } : {})
            }
          }
        )

        if (!originalFileResponse.ok)
          throw new Error(
            `Failed to read original file ${originalFileResponse.status} ${originalFileResponse.statusText} ${await originalFileResponse.text()}`
          )

        const originalFile = (await originalFileResponse.json()) as { download_url: string }

        const translatedFileResponse = await fetch(
          this.routeService.GITHUB_ROUTES.READ_FILE(repositoryOwner, repositoryName, translated) + `?ref=${branch}`,
          {
            headers: {
              Accept: 'application/vnd.github.v3+json',
              'X-GitHub-Api-Version': '2022-11-28',
              ...(req.headers.authorization ? { Authorization: req.headers.authorization } : {})
            }
          }
        )

        if (!translatedFileResponse.ok)
          throw new Error(
            `Failed to read translated file ${translatedFileResponse.status} ${translatedFileResponse.statusText} ${await translatedFileResponse.text()}`
          )

        const translatedFile = (await translatedFileResponse.json()) as { download_url: string }

        return {
          category,
          name,
          original: originalFile.download_url,
          translated: translatedFile.download_url
        }
      })
    )

    await this.cacheManager.set(CACHE_KEYS.FILES(branch), files, 24 * 60 * 60)

    return files
  }
}
